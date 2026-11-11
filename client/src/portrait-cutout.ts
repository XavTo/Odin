import { pipeline, env } from "@huggingface/transformers";

let segmenter: Awaited<ReturnType<typeof createSegmenter>> | undefined;
async function createSegmenter() {
  env.allowLocalModels = false;
  return pipeline("background-removal", "Xenova/modnet", { dtype: "fp32", device: "wasm" });
}
export async function cutoutPortrait(url: string): Promise<string> {
  const input = new Image();
  await new Promise<void>((resolve, reject) => {
    input.onload = () => resolve();
    input.onerror = () => reject(new Error("Photo illisible."));
    input.src = url;
  });
  const scale = Math.min(1, 480 / Math.max(input.naturalWidth, input.naturalHeight));
  const source = document.createElement("canvas");
  source.width = Math.max(1, Math.round(input.naturalWidth * scale));
  source.height = Math.max(1, Math.round(input.naturalHeight * scale));
  source.getContext("2d")!.drawImage(input, 0, 0, source.width, source.height);
  segmenter ??= await createSegmenter();
  const image = await segmenter(source.toDataURL("image/png"));
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image.toCanvas(), 0, 0);
  for (const quality of [0.9, 0.75, 0.6, 0.4, 0.25]) {
    const data = canvas.toDataURL("image/webp", quality);
    if (data.length <= 120000) return data;
  }
  throw new Error("Image détourée trop volumineuse.");
}
