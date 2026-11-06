import {
  boundCaptchaIdentity,
  createBoundCaptchaChallenge,
  verifyBoundCaptcha,
  type CaptchaOptions,
  type CaptchaBinding,
} from "../public-forms/captcha";
export type { CaptchaBinding } from "../public-forms/captcha";
export const createCaptchaChallenge = createBoundCaptchaChallenge;
export const verifyCaptchaProof = verifyBoundCaptcha;
export function captchaProofIdentity(options: CaptchaOptions, token: string) {
  return boundCaptchaIdentity(options, token, "tenant_signup");
}
