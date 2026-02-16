
export enum RefinementType {
  SLIGHT = 'slight',
  PRETTIER = 'prettier',
  REVISION = 'revision',
  FILLER = 'filler',
  CUSTOM = 'custom'
}

export interface RefinementChunk {
  t: string;           // text content
  o: string | null;    // original text if changed, else null
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
}

export interface BurstPreset {
  id: string;
  label: string;
  particleCount: number;
  durationMs: number;
  dotSizePx: number;
  baseDistancePx: number;
  distanceVariancePx: number;
  spreadDeg: number;
  pattern?: 'radial' | 'horizontal';
}

export interface EditorState {
  text: string;
  chunks: RefinementChunk[];
  isLoading: boolean;
  error: string | null;
  user: UserProfile | null;
  customInstruction: string;
}
