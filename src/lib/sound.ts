// Sounds are generated with the Web Audio API, so no audio files are needed.
// Browsers only allow audio after the person has touched the page, so the audio
// context is created (or resumed) on the first tap or key press and kept from then on.
let context: AudioContext | null = null;

export function unlockAudio() {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  } catch { /* No Web Audio support: the game works silently. */ }
}

// A short two-tone siren for a meeting: loud enough to hear from another room.
export function playMeetingAlarm() {
  navigator.vibrate?.([300, 120, 300, 120, 600]);
  if (!context || context.state !== 'running') return;
  const start = context.currentTime + 0.05;
  const gain = context.createGain();
  gain.connect(context.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.35, start + 0.05);
  const oscillator = context.createOscillator();
  oscillator.type = 'square';
  oscillator.connect(gain);
  const step = 0.28;
  for (let index = 0; index < 8; index++) oscillator.frequency.setValueAtTime(index % 2 ? 660 : 880, start + index * step);
  const end = start + 8 * step;
  gain.gain.setValueAtTime(0.35, end - 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

// Simon says: one soft tone per pad, rising from the first pad to the fourth.
const PAD_TONES = [330, 392, 494, 587];
export function playPadTone(pad: number, seconds = 0.3) {
  if (!context || context.state !== 'running') return;
  const start = context.currentTime + 0.01;
  const gain = context.createGain();
  gain.connect(context.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = PAD_TONES[pad] ?? PAD_TONES[0];
  oscillator.connect(gain);
  oscillator.start(start);
  oscillator.stop(start + seconds + 0.02);
}
