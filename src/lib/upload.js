export const cloudinaryConfig = {
  cloudName: "dsehy0jmi",
  unsignedPreset: "alfa_unsigned"
};

export async function uploadMedia(file, onProgress) {
  if (!file) return null;
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) throw new Error("So podes enviar imagens ou videos.");

  const maxImg = 10 * 1024 * 1024;
  const maxVid = 100 * 1024 * 1024;
  if (isImage && file.size > maxImg) throw new Error("Imagem maior que 10MB.");
  if (isVideo && file.size > maxVid) throw new Error("Video maior que 100MB.");
  if (!cloudinaryConfig.cloudName || !cloudinaryConfig.unsignedPreset) throw new Error("Upload nao configurado.");

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryConfig.cloudName)}/${isVideo ? "video" : "image"}/upload`;
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", cloudinaryConfig.unsignedPreset);

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            url: res.secure_url,
            type: isVideo ? "video" : "image",
            width: res.width,
            height: res.height,
            bytes: res.bytes
          });
        } else {
          reject(new Error(res?.error?.message || "Upload falhou"));
        }
      } catch {
        reject(new Error("Resposta invalida do Cloudinary"));
      }
    };
    xhr.onerror = () => reject(new Error("Erro de rede no upload"));
    xhr.send(body);
  });
}
