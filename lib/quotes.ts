// Calming quotes shown when nothing's blowing right now.
// Mix of classic ocean/wind wisdom, surfer humor, and zen.
export const CALM_QUOTES: string[] = [
  '"The sea, once it casts its spell, holds one in its net of wonder forever." — Jacques Cousteau',
  '"Smooth seas do not make skillful sailors." — African proverb',
  '"You can\'t stop the waves, but you can learn to surf." — Jon Kabat-Zinn',
  '"Be patient. The wind always returns to those who wait by the water."',
  '"No wind today — the perfect day to wax the board and breathe."',
  '"Even the ocean rests sometimes. So can you."',
  '"In the end, we conserve only what we love." — Baba Dioum',
  '"Wisdom is knowing the wind, and patience is waiting for it."',
  '"A flat sea is just the wind drawing breath. It will exhale soon."',
  '"The cure for anything is salt water — sweat, tears, or the sea." — Isak Dinesen',
  '"Today the sea is your meditation cushion."',
  '"When wind is rare, every ride becomes a memory."',
  '"You don\'t drown by falling in the water; you drown by staying there. Get up tomorrow."',
  '"Out of stillness comes movement." — Lao Tzu',
  '"The board waits. The wind comes. Coffee in between."',
  '"Calm seas teach you to listen. Stormy ones teach you to act."',
  '"The wind has a memory. It will remember to come back."',
  '"Sometimes the best foiling session is the one you didn\'t take — and survived to ride another day."',
  '"Ride the wave you have, not the one you wished for." — surfer wisdom',
  '"The ocean stirs the heart, inspires the imagination and brings eternal joy to the soul." — Wyland',
];

export function pickRandomQuote(): string {
  return CALM_QUOTES[Math.floor(Math.random() * CALM_QUOTES.length)];
}
