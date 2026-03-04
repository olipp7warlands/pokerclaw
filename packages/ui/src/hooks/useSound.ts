/**
 * Sound effects stub — plays nothing by default.
 * Replace with real Web Audio API calls when you have audio assets.
 */

export type SoundName = "chip" | "card" | "fold" | "win" | "allin";

export function useSound() {
  function play(_name: SoundName) {
    // noop — add Web Audio implementation here
  }

  return { play };
}
