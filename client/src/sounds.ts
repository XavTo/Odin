let enabled = true;
try { enabled = localStorage.getItem("odin-sound") !== "off"; } catch { /* optional */ }
let audio: AudioContext | undefined;
export function soundEnabled(): boolean { return enabled; }
export function toggleSound(): boolean {
  enabled = !enabled;
  try { localStorage.setItem("odin-sound", enabled ? "on" : "off"); } catch { /* optional */ }
  if (enabled) playSound("select", true);
  return enabled;
}
export function prepareSound(): void {
  if (!enabled) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch { /* Sound is optional. */ }
}
export function playSound(kind: "select" | "action" | "turn" | "tick", fromGesture = false): void {
  if (!enabled) return;
  try {
    if (!audio && fromGesture) audio = new AudioContext();
    if (!audio || (!fromGesture && audio.state !== "running")) return;
    const ctx = audio;
    const play = () => {
      const start = ctx.currentTime;
      const tick = kind === "tick";
      const frequencies = tick ? [1050] : kind === "turn" ? [660, 880] : kind === "action" ? [520, 700] : [620];
      frequencies.forEach((frequency, index) => {
        const time = start + index * 0.09;
        const tone = ctx.createOscillator();
        const gain = ctx.createGain();
        tone.type = tick ? "triangle" : "sine";
        tone.frequency.setValueAtTime(frequency, time);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(kind === "select" ? 0.018 : 0.025, time + (tick ? 0.003 : 0.01));
        gain.gain.exponentialRampToValueAtTime(0.0001, time + (tick ? 0.04 : 0.12));
        tone.connect(gain); gain.connect(ctx.destination);
        tone.start(time); tone.stop(time + (tick ? 0.05 : 0.13));
      });
    };
    if (ctx.state === "suspended" && fromGesture) void ctx.resume().then(play).catch(() => {});
    else if (ctx.state === "running") play();
  } catch { /* Sound is optional. */ }
}
