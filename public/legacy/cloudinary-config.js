// =========================================================
// Cloudinary — upload de fotos/vídeos sem Firebase Storage
// =========================================================
//
// Porquê? O Firebase Storage precisa de cartão/plano pago. O Cloudinary
// tem um tier grátis (25GB storage + 25GB bandwidth/mês) que chega e sobra.
//
// Setup (3 minutos, uma única vez):
//   1) Vai a https://cloudinary.com/users/register/free → cria conta grátis.
//   2) Dashboard → copia o "Cloud name" (ex: dlxyz123).
//   3) Settings (roda) → Upload → Upload presets → "Add upload preset".
//      - Upload preset name: põe algo tipo "alfa_unsigned"
//      - Signing Mode: muda para "Unsigned" (IMPORTANTE!)
//      - Folder (opcional): "alfa-club"
//      - Save.
//   4) Cola aqui em baixo os valores:
// =========================================================

export const cloudinaryConfig = {
  cloudName: "dsehy0jmi",
  unsignedPreset: "alfa_unsigned"
};