import { type BackendPlan, type Role, http } from "./core";

export type AuthUser = {
  id: string;
  email: string;
  phone_number?: string | null;
  role: Role;
  plan: BackendPlan;
  can_admin_view?: boolean;
  can_coach_view?: boolean;
  admin_view?: boolean;
  coach_view?: boolean;
  effective_role?: Role;
};

export type TokenResponse = {
  access_token: string;
  token_type: "bearer";
};

export type AuthResponse = {
  token: TokenResponse;
  user: AuthUser;
};

export function apiPing(): Promise<{ pong: boolean }> {
  return http("/api/v1/meta/ping");
}

export function authRegister(
  email: string,
  password: string,
  phoneNumber?: string,
  acceptedLegalVersion?: string,
): Promise<AuthResponse> {
  return http("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      phone_number: phoneNumber || null,
      accepted_legal_version: acceptedLegalVersion || null,
    }),
  });
}

export function authLogin(identifier: string, password: string): Promise<AuthResponse> {
  return http("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
}

// `acceptedLegalVersion`: el backend solo la guarda si la cuenta se crea en este login.
export function authGoogle(idToken: string, acceptedLegalVersion?: string): Promise<AuthResponse> {
  return http("/api/v1/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken, accepted_legal_version: acceptedLegalVersion || null }),
  });
}

export type AppleLoginExtras = {
  authorizationCode?: string | null;
  // Apple solo manda el nombre la primera vez que el usuario autoriza la app.
  fullName?: string | null;
  // El backend solo la guarda si la cuenta se crea en este login.
  acceptedLegalVersion?: string | null;
};

export function authApple(identityToken: string, extras: AppleLoginExtras = {}): Promise<AuthResponse> {
  return http("/api/v1/auth/apple", {
    method: "POST",
    body: JSON.stringify({
      identity_token: identityToken,
      authorization_code: extras.authorizationCode || null,
      full_name: extras.fullName || null,
      accepted_legal_version: extras.acceptedLegalVersion || null,
    }),
  });
}

export function authGuest(): Promise<AuthResponse> {
  return http("/api/v1/auth/guest", {
    method: "POST",
  });
}

export function getMe(): Promise<AuthUser> {
  return http("/api/v1/me");
}

export function deleteMyAccount(confirm: string): Promise<{ ok: boolean }> {
  return http("/api/v1/auth/me", {
    method: "DELETE",
    body: JSON.stringify({ confirm }),
  });
}

export function adminSwitchPlan(payload: {
  email: string;
  plan: BackendPlan;
  role?: Role;
}): Promise<{ ok: boolean; email: string; plan: BackendPlan; role: Role }> {
  return http("/api/v1/admin/dev/switch-plan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
