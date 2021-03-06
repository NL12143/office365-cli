import * as request from 'request-promise-native';

export abstract class Service {
  connected: boolean;
  resource: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;

  public disconnect(): void {
    this.connected = false;
    this.resource = '';
    this.accessToken = '';
    this.refreshToken = undefined;
    this.expiresAt = -1;
  }
}

interface Token {
  access_token: string;
  refresh_token: string;
  expires_on: number;
}

interface Error {
  error: {
    error: string;
    error_description: string;
  };
}

interface DeviceCode {
  interval: number;
  device_code: string;
  message: string;
}

export default class Auth {
  public interval: NodeJS.Timer;

  constructor(public service: Service, private appId?: string) {
  }

  public ensureAccessToken(resource: string, stdout: any, verbose: boolean = false): Promise<string> {
    if (verbose) {
      stdout.log(`Starting Auth.ensureAccessToken. resource: ${resource}, verbose: ${verbose}`);
    }

    return new Promise<string>((resolve: (accessToken: string) => void, reject: (err: any) => void) => {
      const now: number = new Date().getTime() / 1000;

      if (this.service.expiresAt > now &&
        this.service.accessToken !== undefined) {
        if (verbose) {
          stdout.log(`Existing access token ${this.service.accessToken} still valid. Returning...`);
        }
        resolve(this.service.accessToken);
        return;
      }
      else {
        if (verbose) {
          stdout.log(`No existing access token or expired. Token: ${this.service.accessToken}, ExpiresAt: ${this.service.expiresAt}`);
        }
      }

      if (this.service.refreshToken) {
        if (verbose) {
          stdout.log(`Retrieving new access token using existing refresh token ${this.service.refreshToken}`);
        }

        const requestOptions: any = {
          url: 'https://login.microsoftonline.com/common/oauth2/token',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            accept: 'application/json'
          },
          body: `resource=${encodeURIComponent(resource)}&client_id=${this.appId}&grant_type=refresh_token&refresh_token=${this.service.refreshToken}`,
          json: true
        };

        if (verbose) {
          stdout.log('Executing web request...');
          stdout.log(requestOptions);
          stdout.log('');
        }

        request.post(requestOptions)
          .then((json: Token): void => {
            if (verbose) {
              stdout.log('Response:');
              stdout.log(json);
              stdout.log('');
            }

            this.service.accessToken = json.access_token;
            this.service.refreshToken = json.refresh_token;
            this.service.expiresAt = json.expires_on;
            resolve(json.access_token);
            return;
          }, (json: Error): void => {
            if (verbose) {
              stdout.log('Response:');
              stdout.log(json);
              stdout.log('');
            }

            reject(json.error.error);
            return;
          });
      }
      else {
        if (verbose) {
          stdout.log('No existing refresh token. Starting new device code flow...');
        }

        const requestOptions: any = {
          url: `https://login.microsoftonline.com/common/oauth2/devicecode?resource=${resource}&client_id=${this.appId}`,
          headers: {
            accept: 'application/json'
          },
          json: true
        };

        if (verbose) {
          stdout.log('Executing web request...');
          stdout.log(requestOptions);
          stdout.log('');
        }

        request.get(requestOptions)
          .then((json: DeviceCode): void => {
            if (verbose) {
              stdout.log('Response:');
              stdout.log(json);
              stdout.log('');
            }

            const interval = json.interval;
            const deviceCode = json.device_code;
            stdout.log(json.message);

            this.interval = setInterval((): void => {
              const authCheckRequestOptions: any = {
                url: 'https://login.microsoftonline.com/common/oauth2/token',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  accept: 'application/json'
                },
                body: `resource=${encodeURIComponent(resource)}&client_id=${this.appId}&grant_type=device_code&code=${deviceCode}`,
                json: true
              };

              if (verbose) {
                stdout.log('Executing web request:');
                stdout.log(authCheckRequestOptions);
                stdout.log('');
              }

              request.post(authCheckRequestOptions)
                .then((json: Token): void => {
                  if (verbose) {
                    stdout.log('Response:');
                    stdout.log(json);
                    stdout.log('');
                  }

                  this.service.accessToken = json.access_token;
                  this.service.refreshToken = json.refresh_token;
                  this.service.expiresAt = json.expires_on;
                  clearInterval(this.interval);
                  resolve(this.service.accessToken);
                  return;
                }, (rej2: Error): void => {
                  if (rej2.error.error !== 'authorization_pending') {
                    if (verbose) {
                      stdout.log('Response:');
                      stdout.log(rej2);
                      stdout.log('');
                    }

                    clearInterval(this.interval);
                    reject(rej2.error.error);
                    return;
                  }
                  else {
                    if (verbose) {
                      stdout.log('Authorization pending...');
                    }
                  }
                });
            }, interval * 1000);
          }, (err: any): void => {
            reject(err);
          });
      }
    });
  }

  public getAccessToken(resource: string, refreshToken: string, stdout: any, verbose: boolean = false): Promise<string> {
    if (verbose) {
      stdout.log(`Starting Auth.getAccessToken. resource: ${resource}, refreshToken: ${refreshToken}, verbose: ${verbose}`);
    }

    return new Promise<string>((resolve: (accessToken: string) => void, reject: (err: any) => void): void => {
      if (verbose) {
        stdout.log(`Retrieving access token for ${resource} using refresh token ${refreshToken}`);
      }

      const requestOptions: any = {
        url: 'https://login.microsoftonline.com/common/oauth2/token',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          accept: 'application/json'
        },
        body: `resource=${encodeURIComponent(resource)}&client_id=${this.appId}&grant_type=refresh_token&refresh_token=${refreshToken}`,
        json: true
      };

      if (verbose) {
        stdout.log('Executing web request...');
        stdout.log(requestOptions);
        stdout.log('');
      }

      request.post(requestOptions)
        .then((json: Token): void => {
          if (verbose) {
            stdout.log('Response:');
            stdout.log(json);
            stdout.log('');
          }

          resolve(json.access_token);
        }, (err: any): void => {
          reject(err);
        });
    });
  }

  public static getResourceFromUrl(url: string): string {
    let resource: string = url;
    const pos: number = resource.indexOf('/', 8);
    if (pos > -1) {
      resource = resource.substr(0, pos);
    }

    return resource;
  }
}