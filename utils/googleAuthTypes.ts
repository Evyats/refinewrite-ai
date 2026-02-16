export interface GoogleCredentialResponse {
  credential?: string;
}

export interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
}

export interface GoogleRenderedButtonConfig {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  width?: number;
  shape?: 'pill' | 'rectangular' | 'circle' | 'square';
}

export interface GoogleAccountsApi {
  id: {
    initialize: (config: GoogleIdConfiguration) => void;
    renderButton: (element: HTMLElement, config: GoogleRenderedButtonConfig) => void;
    disableAutoSelect: () => void;
  };
}

export interface GoogleJwtPayload {
  name: string;
  email: string;
  picture: string;
}
