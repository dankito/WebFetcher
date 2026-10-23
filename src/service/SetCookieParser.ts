import { ResponseCookie } from "../model/ResponseCookie"

export class SetCookieParser {

  parse(setCookie: string): ResponseCookie | undefined {
    const parts = setCookie.split(";").map((part) => part.trim())
    const nameValue = parts.shift()

    if (!nameValue) {
      return undefined
    }

    const separator = nameValue.indexOf("=")

    if (separator < 1) {
      return undefined
    }

    const cookie = new ResponseCookie(nameValue.slice(0, separator).trim(), nameValue.slice(separator + 1).trim())

    for (const part of parts) {
      const attributeSeparator = part.indexOf("=")
      const key = (attributeSeparator < 0 ? part : part.slice(0, attributeSeparator)).toLowerCase()
      const value = attributeSeparator < 0 ? "" : part.slice(attributeSeparator + 1).trim()

      switch (key) {
        case "domain":
          cookie.domain = value
          break
        case "path":
          cookie.path = value
          break
        case "expires":
          cookie.expires = value
          break
        case "max-age":
          cookie.maxAge = Number.isFinite(Number(value)) ? Number(value) : undefined
          break
        case "httponly":
          cookie.httpOnly = true
          break
        case "secure":
          cookie.secure = true
          break
        case "samesite":
          cookie.sameSite = value
          break
      }
    }

    return cookie
  }

  parseAll(setCookies: string[]): ResponseCookie[] {
    const cookies: ResponseCookie[] = []

    for (const setCookie of setCookies) {
      const cookie = this.parse(setCookie)

      if (cookie) {
        cookies.push(cookie)
      }
    }

    return cookies
  }
}
