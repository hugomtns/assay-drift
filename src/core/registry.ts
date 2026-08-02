export type PathogenId = 'sars-cov-2' | 'h5n1' | 'h3n2';

export interface PathogenConfig {
  id: PathogenId;
  label: string;
  lapisBaseUrl: string;
  segmented: boolean;
  /** Segment name -> human label. Single entry keyed 'main' for unsegmented genomes. */
  segmentLabels: Readonly<Record<string, string>>;
  /** Metadata field to group by for the trend series. */
  dateField: string;
  dateFromParam: string;
  dateToParam: string;
  countryField: string;
  lineageField: string;
  lineageLabel: string;
  defaultWindowMonths: number;
  /** Shown in the methods paragraph and the caveat panel. */
  attribution: string;
}

const INFLUENZA_A_SEGMENTS: Readonly<Record<string, string>> = Object.freeze({
  seg1: 'PB2 (segment 1)',
  seg2: 'PB1 (segment 2)',
  seg3: 'PA (segment 3)',
  seg4: 'HA (segment 4)',
  seg5: 'NP (segment 5)',
  seg6: 'NA (segment 6)',
  seg7: 'M (segment 7)',
  seg8: 'NS (segment 8)',
});

export const PATHOGENS: Readonly<Record<PathogenId, PathogenConfig>> = Object.freeze({
  'sars-cov-2': {
    id: 'sars-cov-2',
    label: 'SARS-CoV-2',
    lapisBaseUrl: 'https://lapis.cov-spectrum.org/open/v2',
    segmented: false,
    segmentLabels: Object.freeze({ main: 'Genome' }),
    dateField: 'date',
    dateFromParam: 'dateFrom',
    dateToParam: 'dateTo',
    countryField: 'country',
    lineageField: 'pangoLineage',
    lineageLabel: 'Pango lineage',
    defaultWindowMonths: 6,
    attribution: 'GenSpectrum LAPIS over the Nextstrain open SARS-CoV-2 dataset (GenBank-derived).',
  },
  h5n1: {
    id: 'h5n1',
    label: 'Influenza A/H5N1',
    lapisBaseUrl: 'https://lapis.genspectrum.org/h5n1',
    segmented: true,
    segmentLabels: INFLUENZA_A_SEGMENTS,
    dateField: 'sampleCollectionDateRangeLower',
    dateFromParam: 'sampleCollectionDateRangeLowerFrom',
    dateToParam: 'sampleCollectionDateRangeUpperTo',
    countryField: 'country',
    lineageField: 'clade',
    lineageLabel: 'Clade',
    defaultWindowMonths: 12,
    attribution: 'GenSpectrum LAPIS over the Loculus H5N1 dataset (INSDC-derived).',
  },
  h3n2: {
    id: 'h3n2',
    label: 'Influenza A/H3N2',
    lapisBaseUrl: 'https://lapis.genspectrum.org/h3n2',
    segmented: true,
    segmentLabels: INFLUENZA_A_SEGMENTS,
    dateField: 'sampleCollectionDateRangeLower',
    dateFromParam: 'sampleCollectionDateRangeLowerFrom',
    dateToParam: 'sampleCollectionDateRangeUpperTo',
    countryField: 'country',
    lineageField: 'cladeHA',
    lineageLabel: 'HA clade',
    defaultWindowMonths: 12,
    attribution: 'GenSpectrum LAPIS over the Loculus H3N2 dataset (INSDC-derived).',
  },
});

export function getPathogen(id: PathogenId): PathogenConfig {
  const cfg = PATHOGENS[id];
  if (!cfg) throw new Error(`Unknown pathogen id "${id}"`);
  return cfg;
}
