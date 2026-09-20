import { useMessages } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Camera,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  ShieldOff,
  Trash2,
  User,
} from "lucide-react";
import { useTranslate } from "ra-core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { normalizeAvatarUrl } from "@/auth/better-auth-oauth-session";
import { uploadAccountAvatar } from "./account-avatar-upload";

type Account = {
  email: string;
  image: string | null;
  name: string;
  twoFactorEnabled: boolean;
};

type AccountTab = "profile" | "security" | "mfa";

type AccountPageProps = {
  apiUrl: string;
};

function requestUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

async function responseMessage(response: Response): Promise<string> {
  const fallback = "No fue posible completar la acción. Inténtalo de nuevo.";
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown } | unknown;
      message?: unknown;
    };
    if (
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
    ) {
      return payload.error.message;
    }
    if (typeof payload.message === "string") return payload.message;
  } catch {
    // Better Auth may return an empty error response.
  }
  return response.statusText || fallback;
}

function accountFromSession(payload: unknown, apiUrl?: string): Account {
  if (!payload || typeof payload !== "object" || !("user" in payload)) {
    throw new Error("No fue posible leer la sesión de tu cuenta.");
  }
  const user = payload.user;
  if (!user || typeof user !== "object") {
    throw new Error("No fue posible leer la sesión de tu cuenta.");
  }
  const value = user as Record<string, unknown>;
  if (typeof value.email !== "string" || typeof value.name !== "string") {
    throw new Error("No fue posible leer la sesión de tu cuenta.");
  }
  const rawImage = typeof value.image === "string" ? value.image : null;
  return {
    email: value.email,
    image: rawImage && apiUrl ? normalizeAvatarUrl(rawImage, apiUrl) : rawImage,
    name: value.name,
    twoFactorEnabled: value.twoFactorEnabled === true,
  };
}

async function accountRequest(
  apiUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(requestUrl(apiUrl, path), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  return response;
}

const avatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxAvatarBytes = 2 * 1024 * 1024;

function accountInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return initials.toLocaleUpperCase() || "U";
}

function notifyIdentityChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("savia:identity-changed"));
  }
}

export function AccountPage({ apiUrl }: AccountPageProps) {
  const t = useMessages(settingsMessages);
  const localError = (message: string) =>
    Object.hasOwn(settingsMessages, message)
      ? t(message as keyof typeof settingsMessages)
      : message;
  const translate = useTranslate();
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [mfaSuccess, setMfaSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [disablingMfa, setDisablingMfa] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const loadAccount = async () => {
    setLoadingAccount(true);
    setAccountError(null);
    try {
      const response = await accountRequest(apiUrl, "/api/auth/get-session");
      setAccount(accountFromSession(await response.json(), apiUrl));
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : translate("savia.account.errors.loadAccount", {
              _: "No fue posible cargar los datos de tu cuenta.",
            }),
      );
    } finally {
      setLoadingAccount(false);
    }
  };

  useEffect(() => {
    void loadAccount();
  }, [apiUrl]);

  useEffect(
    () => () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );

  const uploadAvatar = async (file: File) => {
    if (
      !avatarTypes.has(file.type) ||
      file.size < 1 ||
      file.size > maxAvatarBytes
    ) {
      setAvatarError(
        translate("savia.account.errors.avatarType", {
          _: "Usa una imagen JPG, PNG o WebP de hasta 2 MB.",
        }),
      );
      return;
    }
    const preview = URL.createObjectURL(file);
    setAvatarError(null);
    setAvatarPreview(preview);
    setAvatarProgress(0);
    setUploadingAvatar(true);
    try {
      await uploadAccountAvatar(apiUrl, file, {
        onProgress: setAvatarProgress,
      });
      await loadAccount();
      notifyIdentityChanged();
      setAvatarPreview(null);
    } catch (error) {
      setAvatarPreview(null);
      setAvatarError(
        error instanceof Error
          ? error.message
          : translate("savia.account.errors.avatarUpload", {
              _: "No fue posible subir tu avatar. Inténtalo de nuevo.",
            }),
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarError(null);
    setRemovingAvatar(true);
    try {
      await accountRequest(apiUrl, "/v1/account/avatar", {
        method: "DELETE",
      });
      await loadAccount();
      notifyIdentityChanged();
    } catch (error) {
      setAvatarError(
        error instanceof Error
          ? error.message
          : translate("savia.account.errors.avatarRemove", {
              _: "No fue posible quitar tu avatar. Inténtalo de nuevo.",
            }),
      );
    } finally {
      setRemovingAvatar(false);
    }
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.item(0);
    event.target.value = "";
    if (file) void uploadAvatar(file);
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword.length < 12) {
      setPasswordError(
        translate("savia.account.errors.passwordMinLength", {
          _: "La nueva contraseña debe tener al menos 12 caracteres.",
        }),
      );
      return;
    }
    if (newPassword !== confirmedPassword) {
      setPasswordError(
        translate("savia.account.errors.passwordMismatch", {
          _: "Las contraseñas nuevas no coinciden.",
        }),
      );
      return;
    }
    setChangingPassword(true);
    try {
      await accountRequest(apiUrl, "/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmedPassword("");
      setPasswordSuccess(true);
    } catch (error) {
      setPasswordError(
        error instanceof Error
          ? error.message
          : translate("savia.account.errors.passwordChange", {
              _: "No fue posible actualizar tu contraseña.",
            }),
      );
    } finally {
      setChangingPassword(false);
    }
  };

  const disableMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMfaError(null);
    setMfaSuccess(false);
    setDisablingMfa(true);
    try {
      await accountRequest(apiUrl, "/api/auth/two-factor/disable", {
        method: "POST",
        body: JSON.stringify({ password: mfaPassword }),
      });
      setMfaPassword("");
      setAccount((current) =>
        current ? { ...current, twoFactorEnabled: false } : current,
      );
      setMfaSuccess(true);
    } catch (error) {
      setMfaError(
        error instanceof Error
          ? error.message
          : translate("savia.account.errors.mfaDisable", {
              _: "No fue posible desactivar la MFA.",
            }),
      );
    } finally {
      setDisablingMfa(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl pb-10">
      <header className="py-6">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <User className="size-4" aria-hidden="true" />
          {translate("savia.sidebar.sections.management", { _: "Gestión" })}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {translate("savia.account.pageTitle", { _: "Mi cuenta" })}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {translate("savia.account.pageDescription", {
            _: "Administra las credenciales y las protecciones de tu acceso a Savia.",
          })}
        </p>
      </header>

      <Tabs
        className="gap-4"
        onValueChange={(value) => setActiveTab(value as AccountTab)}
        value={activeTab}
      >
        <TabsList>
          <TabsTrigger value="profile">
            {translate("savia.account.tabs.profile", { _: "Perfil" })}
          </TabsTrigger>
          <TabsTrigger value="security">
            {translate("savia.account.tabs.security", { _: "Seguridad" })}
          </TabsTrigger>
          <TabsTrigger value="mfa">
            {translate("savia.account.tabs.mfa", { _: "MFA" })}
            {account?.twoFactorEnabled ? (
              <Badge className="ml-1.5" variant="outline">
                {translate("savia.account.mfa.activeBadge", { _: "Activa" })}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>
                {translate("savia.account.profile.cardTitle", {
                  _: "Información de acceso",
                })}
              </CardTitle>
              <CardDescription>
                {translate("savia.account.profile.cardDescription", {
                  _: "Datos básicos asociados a tu sesión en Savia.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAccount ? (
                <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  {translate("savia.account.profile.loading", {
                    _: "Cargando tu cuenta…",
                  })}
                </p>
              ) : accountError ? (
                <div className="space-y-3">
                  <Alert variant="destructive">
                    <CircleAlert />
                    <AlertDescription>
                      {localError(accountError)}
                    </AlertDescription>
                  </Alert>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadAccount()}
                  >
                    {translate("ra.action.retry", { _: "Reintentar" })}
                  </Button>
                </div>
              ) : account ? (
                <div className="space-y-6">
                  <section
                    aria-labelledby="profile-avatar-title"
                    className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center"
                  >
                    <Avatar className="size-[72px] ring-1 ring-border">
                      <AvatarImage
                        alt={translate("savia.account.profile.avatarAlt", {
                          name: account.name,
                          _: `Avatar de ${account.name}`,
                        })}
                        src={avatarPreview ?? account.image ?? undefined}
                      />
                      <AvatarFallback className="text-base font-semibold text-primary">
                        {accountInitials(account.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <h3 id="profile-avatar-title" className="font-medium">
                        {translate("savia.account.profile.avatarTitle", {
                          _: "Foto de perfil",
                        })}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {translate("savia.account.profile.avatarDescription", {
                          _: "JPG, PNG o WebP · máximo 2 MB.",
                        })}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={uploadingAvatar || removingAvatar}
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          <Camera className="size-4" aria-hidden="true" />
                          {translate("savia.account.profile.changeAvatar", {
                            _: "Cambiar avatar",
                          })}
                        </Button>
                        {account.image || avatarPreview ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={uploadingAvatar || removingAvatar}
                            onClick={() => void removeAvatar()}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            {removingAvatar
                              ? translate(
                                  "savia.account.profile.removingAvatar",
                                  {
                                    _: "Quitando…",
                                  },
                                )
                              : translate(
                                  "savia.account.profile.removeAvatar",
                                  {
                                    _: "Quitar avatar",
                                  },
                                )}
                          </Button>
                        ) : null}
                      </div>
                      <Label className="sr-only" htmlFor="account-avatar">
                        {translate("savia.account.profile.changeAvatar", {
                          _: "Cambiar avatar",
                        })}
                      </Label>
                      <Input
                        ref={avatarInputRef}
                        id="account-avatar"
                        className="sr-only"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={uploadingAvatar || removingAvatar}
                        onChange={handleAvatarChange}
                      />
                      {uploadingAvatar ? (
                        <div className="mt-4 max-w-sm" role="status">
                          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-2">
                              <LoaderCircle className="size-4 animate-spin" />
                              {translate(
                                "savia.account.profile.uploadingAvatar",
                                {
                                  _: "Subiendo avatar…",
                                },
                              )}
                            </span>
                            <span>
                              {translate(
                                "savia.account.profile.uploadProgress",
                                {
                                  progress: avatarProgress,
                                  _: `${avatarProgress}% cargado`,
                                },
                              )}
                            </span>
                          </div>
                          <div
                            aria-label={translate(
                              "savia.account.profile.uploadProgressAria",
                              { _: "Progreso de carga del avatar" },
                            )}
                            aria-valuemax={100}
                            aria-valuemin={0}
                            aria-valuenow={avatarProgress}
                            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                          >
                            <div
                              className="h-full bg-primary transition-[width] duration-200 ease-out"
                              style={{ width: `${avatarProgress}%` }}
                            />
                          </div>
                        </div>
                      ) : null}
                      {avatarError ? (
                        <Alert className="mt-4 max-w-xl" variant="destructive">
                          <CircleAlert />
                          <AlertDescription>
                            {localError(avatarError)}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                  </section>
                  <dl className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        {translate("savia.users.fields.name", { _: "Nombre" })}
                      </dt>
                      <dd className="mt-1 font-medium">{account.name}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        {translate("savia.users.fields.email", { _: "Correo" })}
                      </dt>
                      <dd className="mt-1 font-medium">{account.email}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>
                {translate("savia.account.security.title", {
                  _: "Contraseña",
                })}
              </CardTitle>
              <CardDescription>
                {translate("savia.account.security.description", {
                  _: "Por seguridad, cerrarás las demás sesiones al actualizarla.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid max-w-2xl gap-4" onSubmit={changePassword}>
                <PasswordField
                  id="current-password"
                  label={translate("savia.account.security.currentPassword", {
                    _: "Contraseña actual",
                  })}
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <PasswordField
                    id="new-password"
                    label={translate("savia.account.security.newPassword", {
                      _: "Nueva contraseña",
                    })}
                    value={newPassword}
                    onChange={setNewPassword}
                    autoComplete="new-password"
                    minLength={12}
                  />
                  <PasswordField
                    id="confirmed-password"
                    label={translate("savia.account.security.confirmPassword", {
                      _: "Confirmar nueva contraseña",
                    })}
                    value={confirmedPassword}
                    onChange={setConfirmedPassword}
                    autoComplete="new-password"
                    minLength={12}
                  />
                </div>
                {passwordError ? (
                  <Alert variant="destructive">
                    <CircleAlert />
                    <AlertDescription>
                      {localError(passwordError)}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {passwordSuccess ? (
                  <p className="text-sm text-primary" role="status">
                    {translate("savia.account.security.success", {
                      _: "Tu contraseña se actualizó y las demás sesiones se cerraron.",
                    })}
                  </p>
                ) : null}
                <div>
                  <Button type="submit" disabled={changingPassword}>
                    <KeyRound className="size-4" />
                    {changingPassword
                      ? translate("savia.account.security.submitting", {
                          _: "Actualizando…",
                        })
                      : translate("savia.account.security.submit", {
                          _: "Actualizar contraseña",
                        })}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mfa">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1.5">
                <CardTitle>
                  {translate("savia.account.mfa.title", {
                    _: "Autenticación multifactor",
                  })}
                </CardTitle>
                <CardDescription>
                  {translate("savia.account.mfa.description", {
                    _: "Protección adicional para el acceso a tu cuenta.",
                  })}
                </CardDescription>
              </div>
              {!loadingAccount && account ? (
                <Badge
                  variant={account.twoFactorEnabled ? "default" : "outline"}
                >
                  {account.twoFactorEnabled
                    ? translate("savia.account.mfa.activeBadge", {
                        _: "Activa",
                      })
                    : translate("savia.account.mfa.disabled", {
                        _: "Inactiva",
                      })}
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent>
              {loadingAccount ? (
                <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  {translate("savia.account.mfa.loading", {
                    _: "Cargando estado de MFA…",
                  })}
                </p>
              ) : account?.twoFactorEnabled ? (
                <>
                  <p className="inline-flex items-center gap-2 text-sm text-primary">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    {translate("savia.account.mfa.activeNotice", {
                      _: "MFA activa en esta cuenta",
                    })}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {translate("savia.account.mfa.activeWarning", {
                      _: "Desactivarla reduce la protección de tu cuenta. Confirma tu contraseña para continuar.",
                    })}
                  </p>
                  <form
                    className="mt-5 flex max-w-2xl flex-col gap-4 sm:flex-row sm:items-end"
                    onSubmit={disableMfa}
                  >
                    <PasswordField
                      id="mfa-password"
                      label={translate("savia.account.mfa.passwordLabel", {
                        _: "Contraseña actual para desactivar MFA",
                      })}
                      value={mfaPassword}
                      onChange={setMfaPassword}
                      autoComplete="current-password"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={disablingMfa}
                    >
                      <ShieldOff className="size-4" />
                      {disablingMfa
                        ? translate("savia.account.mfa.disabling", {
                            _: "Desactivando…",
                          })
                        : translate("savia.account.mfa.disableAction", {
                            _: "Desactivar MFA",
                          })}
                    </Button>
                  </form>
                  {mfaError ? (
                    <Alert className="mt-4" variant="destructive">
                      <CircleAlert />
                      <AlertDescription>
                        {localError(mfaError)}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </>
              ) : account ? (
                <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldOff className="size-4" aria-hidden="true" />
                  {translate("savia.account.mfa.inactiveNotice", {
                    _: "MFA no activa en esta cuenta.",
                  })}
                </p>
              ) : null}
              {mfaSuccess ? (
                <p className="mt-4 text-sm text-primary" role="status">
                  {translate("savia.account.mfa.disabledNotice", {
                    _: "MFA desactivada para esta cuenta.",
                  })}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  autoComplete: string;
  minLength?: number;
}) {
  return (
    <div className="grid flex-1 gap-2 text-sm font-medium">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required
      />
    </div>
  );
}
