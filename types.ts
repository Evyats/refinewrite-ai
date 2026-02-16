
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

export interface EditorState {
  text: string;
  chunks: RefinementChunk[];
  isLoading: boolean;
  error: string | null;
  user: UserProfile | null;
  customInstruction: string;
}
