let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (!audioContext) {
    try { audioContext = new window.AudioContext(); } catch { return null; }
  }
  return audioContext;
}

/** Prepara o áudio após uma interação do usuário, evitando bloqueio de autoplay. */
export function primeNotificationSound(): void {
  const context = getAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

/** Emite um aviso discreto de duas notas para uma nova mensagem. */
export function playNotificationSound(volume = 0.045): void {
  const context = getAudioContext();
  if (!context) return;

  const play = () => {
    const start = context.currentTime;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.setValueAtTime(660, start + 0.11);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.25);
  };

  if (context.state === "suspended") void context.resume().then(play).catch(() => undefined);
  else play();
}
