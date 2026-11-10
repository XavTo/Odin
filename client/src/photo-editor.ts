export type Photos = Record<string, string>;
const MAX_BYTES = 120000;
export function photoFor(photos: Photos, value: number): string {
  return (
    photos[value] ||
    photos[((value - 1) % 9) + 1] ||
    `/${((value - 1) % 9) + 1}.png`
  );
}
export class PhotoEditor {
  private dialog = document.createElement("dialog");
  private photos: Photos = {};
  private original: Photos = {};
  private count = 9;
  private pending = false;
  private message = "";
  private dragValue: number | null = null;
  private save: (photos: Photos) => Promise<void>;
  constructor(save: (photos: Photos) => Promise<void>) {
    this.save = save;
    this.dialog.className = "photo-editor";
    this.dialog.setAttribute("aria-label", "Photos");
    document.body.append(this.dialog);
    this.dialog.addEventListener("cancel", (e) => {
      if (this.pending) e.preventDefault();
    });
    this.dialog.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      );
      if (!button || button.disabled) return;
      const action = button.dataset.photoAction;
      if (action === "close") this.dialog.close();
      if (action === "reset") {
        this.photos = {};
        this.message = "";
        this.render();
      }
      if (action === "undo") {
        this.photos = { ...this.original };
        this.message = "";
        this.render();
      }
      if (action === "save") void this.persist();
      if (action === "restore") {
        delete this.photos[button.dataset.value!];
        this.render();
      }
      if (action === "move")
        this.swap(Number(button.dataset.value), Number(button.dataset.to));
    });
    this.dialog.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files?.length)
        void this.importFiles(
          [...input.files],
          input.dataset.value ? Number(input.dataset.value) : undefined,
        );
    });
    this.dialog.addEventListener("dragstart", (e) => {
      if (this.pending) {
        e.preventDefault();
        return;
      }
      const slot = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-photo-slot]",
      );
      this.dragValue = slot ? Number(slot.dataset.photoSlot) : null;
      if (this.dragValue)
        e.dataTransfer?.setData("text/plain", String(this.dragValue));
    });
    this.dialog.addEventListener("dragend", () => {
      this.dragValue = null;
    });
    this.dialog.addEventListener("dragover", (e) => {
      if (!this.pending) e.preventDefault();
    });
    this.dialog.addEventListener("drop", (e) => {
      e.preventDefault();
      if (this.pending) return;
      const slot = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-photo-slot]",
      );
      if (e.dataTransfer?.files.length) {
        this.dragValue = null;
        const files = [...e.dataTransfer.files];
        void this.importFiles(
          files,
          files.length === 1 && slot
            ? Number(slot.dataset.photoSlot)
            : undefined,
        );
        return;
      }
      if (slot && this.dragValue)
        this.swap(this.dragValue, Number(slot.dataset.photoSlot));
      this.dragValue = null;
    });
  }
  open(photos: Photos, count: number) {
    if (this.dialog.open) return;
    this.photos = { ...photos };
    this.original = { ...photos };
    this.count = count;
    this.pending = false;
    this.message = "";
    this.render();
    this.dialog.showModal();
  }
  private render() {
    this.dialog.innerHTML = `<div class="photo-editor-heading"><h2>Photos</h2><button class="text" data-photo-action="close" aria-label="Fermer" ${this.pending ? "disabled" : ""}>✕</button></div><div class="photo-editor-toolbar"><label class="photo-import-button">Importer des photos<input type="file" multiple accept="image/*" aria-label="Importer des photos" ${this.pending ? "disabled" : ""}></label><button class="text" data-photo-action="reset" ${this.pending ? "disabled" : ""}>Photos d’origine</button><button class="text" data-photo-action="undo" ${this.pending ? "disabled" : ""}>Annuler les changements</button></div><div class="photo-editor-grid">${Array.from(
      { length: this.count },
      (_, i) => {
        const n = i + 1;
        return `<article class="photo-editor-slot" data-photo-slot="${n}" draggable="${!this.pending}"><label class="photo-editor-picture"><img src="${photoFor(this.photos, n)}" alt="Photo ${n}" draggable="false"><input type="file" accept="image/*" data-value="${n}" aria-label="Changer la photo ${n}" ${this.pending ? "disabled" : ""}><span>${n}</span></label><div class="photo-editor-controls"><button class="text" data-photo-action="move" data-value="${n}" data-to="${n - 1}" aria-label="Déplacer la photo ${n} à gauche" ${this.pending || n === 1 ? "disabled" : ""}>←</button><button class="text" data-photo-action="restore" data-value="${n}" aria-label="Rétablir la photo ${n}" ${this.pending || !this.photos[n] ? "disabled" : ""}>↺</button><button class="text" data-photo-action="move" data-value="${n}" data-to="${n + 1}" aria-label="Déplacer la photo ${n} à droite" ${this.pending || n === this.count ? "disabled" : ""}>→</button></div></article>`;
      },
    ).join(
      "",
    )}</div><div class="photo-editor-footer"><p role="status" class="photo-editor-message"></p><button data-photo-action="save" ${this.pending ? "disabled" : ""}>${this.pending ? "En cours…" : "Enregistrer"}</button></div>`;
    this.dialog.querySelector(".photo-editor-message")!.textContent =
      this.message;
  }
  private swap(from: number, to: number) {
    if (to < 1 || to > this.count || from === to || this.pending) return;
    const a = photoFor(this.photos, from),
      b = photoFor(this.photos, to);
    for (const [value, url] of [
      [from, b],
      [to, a],
    ] as const) {
      if (url.startsWith("data:")) this.photos[value] = url;
      else delete this.photos[value];
    }
    this.message = "";
    this.render();
  }
  private async resize(file: File): Promise<string> {
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
      throw new Error("Choisissez des images de moins de 20 Mo.");
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const format = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
      for (const quality of [0.75, 0.6, 0.4]) {
        const image = canvas.toDataURL(format, quality);
        if (image.length <= MAX_BYTES) return image;
      }
      throw new Error("Image trop volumineuse.");
    } finally {
      bitmap.close();
    }
  }
  private async importFiles(files: File[], value?: number) {
    if (this.pending) return;
    if (files.length > this.count) {
      this.message = `Choisissez au plus ${this.count} photos.`;
      this.render();
      return;
    }
    this.pending = true;
    this.message = "";
    this.render();
    try {
      const next = { ...this.photos };
      const numbered = files.map((f) =>
        Number(f.name.match(/^(\d{1,2})(?:\D|$)/)?.[1]),
      );
      const useNumbers =
        value === undefined &&
        numbered.every((n) => n >= 1 && n <= this.count) &&
        new Set(numbered).size === files.length;
      if (value === undefined)
        for (let n = 1; n <= this.count; n++) delete next[n];
      for (const [i, file] of files.entries()) {
        this.message = `${i + 1} / ${files.length}`;
        this.dialog.querySelector(".photo-editor-message")!.textContent =
          this.message;
        next[value ?? (useNumbers ? numbered[i] : i + 1)] =
          await this.resize(file);
      }
      this.photos = next;
      this.message = "";
    } catch (e) {
      this.message = e instanceof Error ? e.message : "Image illisible.";
    } finally {
      this.pending = false;
      this.render();
    }
  }
  private async persist() {
    if (this.pending) return;
    this.pending = true;
    this.message = "";
    this.render();
    try {
      await this.save({ ...this.photos });
      this.dialog.close();
    } catch (e) {
      this.message =
        e instanceof Error ? e.message : "Enregistrement impossible.";
    } finally {
      this.pending = false;
      this.render();
    }
  }
}
