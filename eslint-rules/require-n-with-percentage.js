/**
 * `require-n-with-percentage` — Global Constraint 6.
 *
 * Forbids a literal `%` anywhere in the UI source: in JSX text, in a template
 * literal, and in a plain string. A percentage the user can see must come out
 * of `formatRate()` in `src/ui/format.ts`, which is the only function that
 * cannot emit a rate without its numerator and denominator beside it.
 *
 * The rule is deliberately blunt, and that is the point. Any cleverer version
 * would have to decide whether a given `%` ends up on screen, and the failure
 * mode it exists to prevent — "95.9%" quoted out of a screenshot with no idea
 * what 95.9% of what — is created precisely by the cases a clever rule would
 * wave through.
 *
 * Two allowances, both by *construct* rather than by filename, so they cannot
 * rot into a licence for the file that carries them:
 *
 * - a `%` inside a `style` or `className` JSX attribute. Those are CSS
 *   lengths, never statistics; `GenomeMap` positions its ticks with them.
 * - comments. They are not string or JSX nodes, so the rule never visits them,
 *   and the prose in `AttributionTable`, `PositionProfile`, `TrendChart` and
 *   `GenomeMap` that explains the percentage rules is untouched. This is not a
 *   special case in the code — it falls out of only visiting literals.
 *
 * The one filename exemption is `src/ui/format.ts`, which *is* the
 * implementation: it has to type the character somewhere.
 */

/** JSX attributes whose value is CSS, never text a reader sees. */
const PRESENTATIONAL_ATTRIBUTES = new Set(['style', 'className']);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every rendered percentage to come from formatRate(), so it can never appear without its N.',
    },
    schema: [],
    messages: {
      barePercent:
        'A literal "%" in the UI. Render rates with formatRate() from src/ui/format, which always states the counts beside the percentage (Global Constraint 6). CSS lengths belong in a style or className attribute.',
    },
  },

  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(/\\/g, '/');
    // The formatters themselves. Nothing else in src/ui may type the character.
    if (filename.endsWith('/src/ui/format.ts') || filename === 'src/ui/format.ts') return {};

    const sourceCode = context.sourceCode;

    /** True when `node` sits inside a style/className JSX attribute. */
    const isPresentational = (node) => {
      for (const ancestor of sourceCode.getAncestors(node)) {
        if (
          ancestor.type === 'JSXAttribute' &&
          ancestor.name.type === 'JSXIdentifier' &&
          PRESENTATIONAL_ATTRIBUTES.has(ancestor.name.name)
        ) {
          return true;
        }
      }
      return false;
    };

    const report = (node) => {
      if (isPresentational(node)) return;
      context.report({ node, messageId: 'barePercent' });
    };

    return {
      JSXText(node) {
        if (node.value.includes('%')) report(node);
      },
      TemplateElement(node) {
        if (node.value.raw.includes('%')) report(node);
      },
      Literal(node) {
        if (typeof node.value === 'string' && node.value.includes('%')) report(node);
      },
    };
  },
};

export default rule;
