export class ResponseCookie {
  constructor(
    public name: string,
    public value: string,
    public domain?: string,
    public path?: string,
    public expires?: string,
    public maxAge?: number,
    public httpOnly?: boolean,
    public secure?: boolean,
    public sameSite?: string,
  ) {}
}
