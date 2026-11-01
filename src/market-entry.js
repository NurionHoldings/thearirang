import {
  signup,
  login,
  logout,
  getUser,
  getSettings,
  handleAuthCallback,
  updateUser,
  requestPasswordRecovery,
  onAuthChange,
} from "@netlify/identity";
window.ARIRANG_MEMBER_AUTH = {
  signup,
  login,
  logout,
  getUser,
  getSettings,
  updateUser,
  requestPasswordRecovery,
  ready: (async () => {
    const result = await handleAuthCallback();
    if (result?.type === "recovery") window.ARIRANG_MEMBER_RECOVERY = true;
    await getUser();
    return getSettings();
  })(),
};
// Attach a handler immediately; the storefront renders the error instead of an unhandled rejection.
window.ARIRANG_MEMBER_AUTH.ready.catch(() => {});
onAuthChange((event) => {
  if (event === "logout")
    window.dispatchEvent(new Event("arirang:member-logout"));
});
await import("../public/arirang-local.js");
