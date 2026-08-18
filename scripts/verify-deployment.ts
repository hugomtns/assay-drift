/**
 * Verifies a deployed Assay Drift Watch against the invariants that matter.
 *
 * This replaces an earlier practice of checking that the served JavaScript
 * bundle was byte-identical to a local build. That check stopped holding when
 * Vercel's build environment resolved a different toolchain version, and it was
 * never the right check to begin with: byte-identity proved only that *this
 * machine* had produced those bytes, not that the correct source had shipped or
 * that the deployed site behaved. A build that is byte-identical to a broken
 * local build passes it. The first Phase 6 deploy was exactly that -- the
 * bundle was fine and every request 500'd.
 *
 * What is asserted here instead, all against the live origin:
 *
 * 1. **Content the product is not allowed to ship without.** The regulatory
 *    statement verbatim and all four severity words -- imported from the source
 *    of truth below, never retyped, so a wording change cannot leave this file
 *    asserting the old text.
 * 2. **Content it is not allowed to ship with.** The framings the copy rules
 *    forbid.
 * 3. **That the proxy works**, which no bundle check can see: a real query
 *    returns real data, repeat requests are served from the edge cache, and the
 *    allow-list rejects a look-alike host.
 *
 * Usage: `npm run verify:deploy [origin]`, default https://assay-drift.vercel.app
 */
import { REGULATORY_STATEMENT, UNIT_OF_ANALYSIS } from '../src/core/analysis/constants';
import { SEVERITY_LABELS } from '../src/ui/results/severity-labels';
import { PATHOGENS } from '../src/core/registry';

const origin = process.argv[2] ?? 'https://assay-drift.vercel.app';

let failures = 0;

function check(ok: boolean, label: string, detail = ''): void {
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  console.log(`Verifying deployment at ${origin}\n`);

  // --- The served application -------------------------------------------
  const indexRes = await fetch(origin);
  check(indexRes.ok, 'index.html responds', `HTTP ${String(indexRes.status)}`);
  const html = await indexRes.text();

  const bundlePath = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
  if (bundlePath === undefined) {
    check(false, 'index.html references a JS bundle');
    process.exit(1);
  }
  const bundle = await (await fetch(`${origin}${bundlePath}`)).text();
  console.log(`\n  served bundle: ${bundlePath} (${bundle.length.toLocaleString('en-US')} bytes)\n`);

  // Global Constraint 8. Imported, never retyped: if the wording changes, this
  // check follows it, and if the deployment lags the change it fails.
  check(bundle.includes(REGULATORY_STATEMENT), 'regulatory statement is in the bundle, verbatim');
  check(bundle.includes(UNIT_OF_ANALYSIS), 'unit of analysis is in the bundle, verbatim');

  for (const label of Object.values(SEVERITY_LABELS)) {
    check(bundle.includes(label), `severity label present: "${label}"`);
  }

  // The copy rules, stated as absences. A tool that counts sequences must not
  // claim to forecast an assay, and "failure" belongs only to the historical
  // Alpha case.
  for (const phrase of ['mutation in your primer', 'will fail', 'predicts assay', 'guarantee']) {
    check(!bundle.includes(phrase), `forbidden framing absent: "${phrase}"`);
  }

  // --- The proxy, which no bundle check can see -------------------------
  const sc2 = PATHOGENS['sars-cov-2'];
  if (sc2 === undefined) throw new Error('sars-cov-2 missing from the registry');

  const query = (baseUrl: string, endpoint: string, body: unknown): string => {
    const search = new URLSearchParams();
    search.set('baseUrl', baseUrl);
    search.set('endpoint', endpoint);
    search.set('body', JSON.stringify(body));
    return `${origin}/api/lapis?${search.toString()}`;
  };

  const url = query(sc2.lapisBaseUrl, 'aggregated', {
    country: 'Switzerland',
    dateFrom: '2021-02-01',
    dateTo: '2021-03-01',
  });

  console.log('');
  const first = await fetch(url);
  const payload = (await first.json()) as { data?: { count?: number }[] };
  const count = payload.data?.[0]?.count;
  check(first.ok, 'proxy returns a real LAPIS answer', `HTTP ${String(first.status)}`);
  check(
    typeof count === 'number' && count > 0,
    'the answer carries a positive sequence count',
    `count = ${String(count)}`,
  );
  check(
    first.headers.get('X-Assay-Drift-Proxy') === 'upstream',
    'the answer is stamped as coming from LAPIS, not from the proxy',
  );

  // The whole reason the browser hop is a GET. A POST here answers MISS every
  // time, which is what this replaced.
  const second = await fetch(url);
  const cache = second.headers.get('X-Vercel-Cache');
  check(cache === 'HIT' || cache === 'STALE', 'a repeat request is served from the edge cache', `X-Vercel-Cache: ${cache ?? 'absent'}`);

  // The security boundary. A look-alike host is the case a substring check
  // would wave through.
  const lookalike = await fetch(
    query('https://lapis.cov-spectrum.org.evil.test/open/v2', 'aggregated', {}),
  );
  check(lookalike.status === 403, 'the allow-list rejects a look-alike host', `HTTP ${String(lookalike.status)}`);

  const badEndpoint = await fetch(query(sc2.lapisBaseUrl, 'referenceGenome', {}));
  check(badEndpoint.status === 400, 'an unknown endpoint is rejected', `HTTP ${String(badEndpoint.status)}`);

  console.log('');
  if (failures > 0) {
    console.error(`${String(failures)} deployment check(s) FAILED at ${origin}.`);
    process.exit(1);
  }
  console.log(`All deployment checks passed at ${origin}.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
