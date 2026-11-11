const MAX_PHOTO_BYTES = 120000;

/** The output is the portion shown in the preview, at the target aspect ratio. */
export async function cropImage(
  file: File,
  background: boolean,
  label: string,
): Promise<string | null> {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    throw new Error("Choisissez des images de moins de 20 Mo.");
  const bitmap = await createImageBitmap(file);
  const dialog = document.createElement("dialog");
  dialog.className = "image-cropper";
  dialog.setAttribute("aria-label", "Recadrer la photo");
  const ratio = background ? 16 / 9 : 7 / 10;
  dialog.innerHTML = `<h2>Recadrer</h2><p class="crop-label"></p><p>Déplacez l’image et ajustez le zoom.</p><canvas class="crop-preview" aria-label="Aperçu du recadrage"></canvas><label class="crop-control">Zoom<input type="range" data-crop="zoom" min="1" max="4" step="0.01" value="1"></label><label class="crop-control">Horizontal<input type="range" data-crop="x" min="0" max="100" value="50"></label><label class="crop-control">Vertical<input type="range" data-crop="y" min="0" max="100" value="50"></label><p class="crop-error" role="alert"></p><div class="actions"><button type="button" class="secondary" data-crop="cancel">Annuler</button><button type="button" data-crop="apply">Utiliser</button></div>`;
  dialog.querySelector(".crop-label")!.textContent = label;
  const canvas = dialog.querySelector<HTMLCanvasElement>("canvas")!;
  const zoom = dialog.querySelector<HTMLInputElement>('[data-crop="zoom"]')!;
  const x = dialog.querySelector<HTMLInputElement>('[data-crop="x"]')!;
  const y = dialog.querySelector<HTMLInputElement>('[data-crop="y"]')!;
  const error = dialog.querySelector<HTMLElement>(".crop-error")!;
  const longSide = background ? 1920 : 480;
  canvas.width = Math.round(ratio >= 1 ? longSide : longSide * ratio);
  canvas.height = Math.round(ratio >= 1 ? longSide / ratio : longSide);
  canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Recadrage indisponible.");
  }
  function bounds() {
    const scale = Number(zoom.value);
    const width = Math.min(bitmap.width, bitmap.height * ratio) / scale;
    const height = width / ratio;
    return {
      width,
      height,
      left: ((bitmap.width - width) * Number(x.value)) / 100,
      top: ((bitmap.height - height) * Number(y.value)) / 100,
    };
  }
  function draw() {
    const { left, top, width, height } = bounds();
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.drawImage(
      bitmap,
      left,
      top,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }
  [zoom, x, y].forEach((input) => input.addEventListener("input", draw));
  let drag: { px: number; py: number; x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drag = {
      px: event.clientX,
      py: event.clientY,
      x: Number(x.value),
      y: Number(y.value),
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const { width, height } = bounds();
    const availableX = bitmap.width - width,
      availableY = bitmap.height - height;
    if (availableX > 0)
      x.value = String(
        Math.max(
          0,
          Math.min(
            100,
            drag.x -
              ((((event.clientX - drag.px) / rect.width) * width) /
                availableX) *
                100,
          ),
        ),
      );
    if (availableY > 0)
      y.value = String(
        Math.max(
          0,
          Math.min(
            100,
            drag.y -
              ((((event.clientY - drag.py) / rect.height) * height) /
                availableY) *
                100,
          ),
        ),
      );
    draw();
  });
  canvas.addEventListener("pointerup", () => {
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => {
    drag = null;
  });
  document.body.append(dialog);
  draw();
  return new Promise((resolve, reject) => {
    let result: string | null = null;
    let failure: unknown;
    dialog.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      )?.dataset.crop;
      if (action === "cancel") dialog.close();
      if (action !== "apply") return;
      try {
        const format = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
        for (const quality of [0.75, 0.6, 0.4, 0.25]) {
          const image = canvas.toDataURL(format, quality);
          if (image.length <= (background ? 500000 : MAX_PHOTO_BYTES)) {
            result = image;
            dialog.close();
            return;
          }
        }
        error.textContent = "Image trop volumineuse.";
      } catch (e) {
        failure = e;
        dialog.close();
      }
    });
    dialog.addEventListener(
      "close",
      () => {
        bitmap.close();
        dialog.remove();
        if (failure) reject(failure);
        else resolve(result);
      },
      { once: true },
    );
    try {
      dialog.showModal();
    } catch (e) {
      bitmap.close();
      dialog.remove();
      reject(e);
    }
  });
}
