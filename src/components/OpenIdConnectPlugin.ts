import { App, ref, reactive, Ref, inject, watch, WatchStopHandle } from "vue"
import { Router, NavigationGuardNext } from "vue-router"

const loginRedirectRouteKey = "oidc-login-redirect-route"

export interface OpenIdConnectConfiguration {
  baseUrl: string
  tokenEndpoint: string
  authEndpoint: string
  logoutEndpoint: string
  clientId: string
  clientSecret?: string
  scope?: string
  authorizedRedirectRoute: string
  // Properties needed for doing token call on backend server (more secure and keeps clientSecret out of frontend config)
  serverBaseUrl?: string
  serverTokenEndpoint?: string
  serverRefreshEndpoint?: string
  internalRedirectUrl?: string
  apiCodeEndpoint?: string
}
const defaultConfig: OpenIdConnectConfiguration = {
  baseUrl: "",
  serverBaseUrl: undefined,
  tokenEndpoint: "token",
  authEndpoint: "auth",
  logoutEndpoint: "logout",
  clientId: "",
  authorizedRedirectRoute: "/",
  serverTokenEndpoint: "token/",
  serverRefreshEndpoint: "refresh/",
  internalRedirectUrl: "",
  apiCodeEndpoint: "/api/auth_code",
}

export interface OpenIdConnectUserInformation {
  name: string
  preferred_username: string
  given_name: string
  family_name: string
  email: string
}

export const DefaultOIDC: unique symbol = Symbol("Auth")
export const useAuth = () => inject<OpenIdConnectClient>(DefaultOIDC)!

export class OpenIdConnectClient {
  isAuthenticated: Ref<boolean>
  loading: Ref<boolean>
  error: Ref<any>
  config: OpenIdConnectConfiguration
  authCode: Ref<string | null>
  user: Ref<string | null>

  constructor(config: Partial<OpenIdConnectConfiguration>) {
    console.log(`>OpenIdConnectClient v0.1.5`)
    this.isAuthenticated = ref(false)
    this.loading = ref(false)
    this.error = ref(undefined)
    this.config = reactive({ ...defaultConfig, ...config })
    this.authCode = ref(null)
    this.user = ref(null)
  }

  install(app: App) {
    app.provide(DefaultOIDC, this)
  }

  async processAuthCode(authCode: string, router: Router) {
    this.loading.value = true
    try {
      await this.sendReceivedCode(authCode)
      this.isAuthenticated.value = true
      this.authCode.value = authCode
      const storedRedirectRoute =
        sessionStorage.getItem(loginRedirectRouteKey) || ""
      sessionStorage.removeItem(loginRedirectRouteKey)
      router.push({
        path: storedRedirectRoute,
      })
    } catch (e) {
      this.isAuthenticated.value = false
      this.error.value = e
    }
    this.loading.value = false
  }

  async verifyServerAuth() {
    this.loading.value = true
    try {
      const res = await fetch("/api/me", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      })
      res.status !== 401 ? this.user.value = await res.json() as string : null
      this.isAuthenticated.value = res.status !== 401
    } catch (e) {
      this.isAuthenticated.value = false
      this.authCode.value = null
      this.user.value = null
      this.error.value = e
    }
    this.loading.value = false
  }

  async sendReceivedCode(authCode: string) {
    const { baseUrl, clientId, tokenEndpoint, internalRedirectUrl } =
      this.config
    await fetch(`${this.config.apiCodeEndpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        realm: baseUrl,
        authCode,
        clientId,
        tokenEndpoint,
        redirectUri: new URL(
          internalRedirectUrl || this.config.authorizedRedirectRoute,
          decodeURI(window.location.href)
        ).toString(),
      }),
    })
  }

  redirectToLogin(finalRedirectRoute?: string) {
    if (finalRedirectRoute) {
      sessionStorage.setItem(loginRedirectRouteKey, finalRedirectRoute)
    }
    const { authEndpoint, baseUrl, clientId, internalRedirectUrl, scope } =
      this.config
    const params = new URLSearchParams({
      scope: scope || "openid",
      client_id: clientId,
      response_type: "code",
      redirect_uri: new URL(
        internalRedirectUrl || this.config.authorizedRedirectRoute,
        decodeURI(window.location.href)
      ).toString(),
    })
    window.location.href = `${baseUrl}${authEndpoint}?${params}`
  }

  async assertIsAuthenticated(
    dest: string,
    cb: NavigationGuardNext
  ): Promise<void> {
    await waitTillFalse(this.loading)
    if (this.isAuthenticated.value) {
      return cb()
    }
    await this.verifyServerAuth()
    await waitTillFalse(this.loading)
    if (this.isAuthenticated.value) {
      return cb()
    }
    this.redirectToLogin(dest)
    return cb(false)
  }

  resetAuthProperties() {
    this.user != null ? this.user.value = null : this.user
    this.authCode != null ? this.authCode.value = null : this.authCode
    this.isAuthenticated.value = false
  }
}

async function waitTillFalse(x: Ref<unknown>): Promise<void> {
  return new Promise((resolve, _reject) => {
    if (!x.value) {
      return resolve()
    }
    /* eslint-disable prefer-const */
    let stopWatch: WatchStopHandle
    stopWatch = watch(x, (loading) => {
      if (!loading) {
        stopWatch()
        resolve()
      }
    })
  })
}
