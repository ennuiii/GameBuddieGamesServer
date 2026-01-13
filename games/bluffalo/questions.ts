/**
 * Bluffalo Question Bank
 *
 * Each question has an obscure but real answer that's hard to guess,
 * making it perfect for players to create believable fake answers.
 */

import type { Question, QuestionCategory } from './types.js';

export const QUESTIONS: Question[] = [
  // ============================================================================
  // HISTORY (15 questions)
  // ============================================================================
  {
    id: 'hist-001',
    category: 'history',
    text: 'What was the name of the first animal to orbit the Earth?',
    correctAnswer: 'Laika',
    difficulty: 'medium'
  },
  {
    id: 'hist-002',
    category: 'history',
    text: 'What year did the first Pizza Hut open?',
    correctAnswer: '1958',
    difficulty: 'hard'
  },
  {
    id: 'hist-003',
    category: 'history',
    text: 'What was the original name of New York City?',
    correctAnswer: 'New Amsterdam',
    difficulty: 'medium'
  },
  {
    id: 'hist-004',
    category: 'history',
    text: 'What ancient wonder was located in Alexandria, Egypt?',
    correctAnswer: 'The Lighthouse of Alexandria',
    difficulty: 'medium'
  },
  {
    id: 'hist-005',
    category: 'history',
    text: 'What was the shortest war in history between Britain and which country?',
    correctAnswer: 'Zanzibar',
    difficulty: 'hard'
  },
  {
    id: 'hist-006',
    category: 'history',
    text: 'What was the first toy to be advertised on television?',
    correctAnswer: 'Mr. Potato Head',
    difficulty: 'hard'
  },
  {
    id: 'hist-007',
    category: 'history',
    text: 'What color were carrots before the 17th century?',
    correctAnswer: 'Purple',
    difficulty: 'medium'
  },
  {
    id: 'hist-008',
    category: 'history',
    text: 'What was the first product to have a barcode scanned in a store?',
    correctAnswer: 'Wrigley\'s chewing gum',
    difficulty: 'hard'
  },
  {
    id: 'hist-009',
    category: 'history',
    text: 'What was invented first: the lighter or the match?',
    correctAnswer: 'The lighter',
    difficulty: 'medium'
  },
  {
    id: 'hist-010',
    category: 'history',
    text: 'What Roman emperor made his horse a senator?',
    correctAnswer: 'Caligula',
    difficulty: 'medium'
  },
  {
    id: 'hist-011',
    category: 'history',
    text: 'What was the first message sent over the internet?',
    correctAnswer: 'LO',
    difficulty: 'hard'
  },
  {
    id: 'hist-012',
    category: 'history',
    text: 'What country gave the Statue of Liberty to the United States?',
    correctAnswer: 'France',
    difficulty: 'easy'
  },
  {
    id: 'hist-013',
    category: 'history',
    text: 'What was the name of the ship that brought the Pilgrims to America?',
    correctAnswer: 'Mayflower',
    difficulty: 'easy'
  },
  {
    id: 'hist-014',
    category: 'history',
    text: 'What was bubble wrap originally invented to be?',
    correctAnswer: 'Wallpaper',
    difficulty: 'hard'
  },
  {
    id: 'hist-015',
    category: 'history',
    text: 'What was the first country to give women the right to vote?',
    correctAnswer: 'New Zealand',
    difficulty: 'medium'
  },

  // ============================================================================
  // SCIENCE (15 questions)
  // ============================================================================
  {
    id: 'sci-001',
    category: 'science',
    text: 'What is the only planet that spins clockwise?',
    correctAnswer: 'Venus',
    difficulty: 'hard'
  },
  {
    id: 'sci-002',
    category: 'science',
    text: 'How many hearts does an octopus have?',
    correctAnswer: 'Three',
    difficulty: 'medium'
  },
  {
    id: 'sci-003',
    category: 'science',
    text: 'What is the hardest natural substance on Earth?',
    correctAnswer: 'Diamond',
    difficulty: 'easy'
  },
  {
    id: 'sci-004',
    category: 'science',
    text: 'What is the fear of long words called?',
    correctAnswer: 'Hippopotomonstrosesquippedaliophobia',
    difficulty: 'hard'
  },
  {
    id: 'sci-005',
    category: 'science',
    text: 'What percentage of the human body is water?',
    correctAnswer: '60 percent',
    difficulty: 'medium'
  },
  {
    id: 'sci-006',
    category: 'science',
    text: 'What is the only mammal capable of true flight?',
    correctAnswer: 'Bat',
    difficulty: 'easy'
  },
  {
    id: 'sci-007',
    category: 'science',
    text: 'How long is a day on Venus in Earth days?',
    correctAnswer: '243 Earth days',
    difficulty: 'hard'
  },
  {
    id: 'sci-008',
    category: 'science',
    text: 'What animal has the longest lifespan?',
    correctAnswer: 'Ocean quahog clam',
    difficulty: 'hard'
  },
  {
    id: 'sci-009',
    category: 'science',
    text: 'What is the chemical symbol for gold?',
    correctAnswer: 'Au',
    difficulty: 'easy'
  },
  {
    id: 'sci-010',
    category: 'science',
    text: 'How many bones does an adult human have?',
    correctAnswer: '206',
    difficulty: 'medium'
  },
  {
    id: 'sci-011',
    category: 'science',
    text: 'What gas makes up about 78% of Earth\'s atmosphere?',
    correctAnswer: 'Nitrogen',
    difficulty: 'medium'
  },
  {
    id: 'sci-012',
    category: 'science',
    text: 'What organ uses 20% of the body\'s oxygen despite being only 2% of body weight?',
    correctAnswer: 'The brain',
    difficulty: 'medium'
  },
  {
    id: 'sci-013',
    category: 'science',
    text: 'What is the smallest bone in the human body?',
    correctAnswer: 'Stapes',
    difficulty: 'hard'
  },
  {
    id: 'sci-014',
    category: 'science',
    text: 'How fast does light travel in miles per second?',
    correctAnswer: '186,000 miles per second',
    difficulty: 'hard'
  },
  {
    id: 'sci-015',
    category: 'science',
    text: 'What color is a polar bear\'s skin?',
    correctAnswer: 'Black',
    difficulty: 'medium'
  },

  // ============================================================================
  // GEOGRAPHY (10 questions)
  // ============================================================================
  {
    id: 'geo-001',
    category: 'geography',
    text: 'What is the smallest country in the world?',
    correctAnswer: 'Vatican City',
    difficulty: 'easy'
  },
  {
    id: 'geo-002',
    category: 'geography',
    text: 'What is the longest river in the world?',
    correctAnswer: 'The Nile',
    difficulty: 'easy'
  },
  {
    id: 'geo-003',
    category: 'geography',
    text: 'What country has the most islands?',
    correctAnswer: 'Sweden',
    difficulty: 'hard'
  },
  {
    id: 'geo-004',
    category: 'geography',
    text: 'What is the driest place on Earth?',
    correctAnswer: 'Atacama Desert',
    difficulty: 'hard'
  },
  {
    id: 'geo-005',
    category: 'geography',
    text: 'What city is known as the "City of Canals"?',
    correctAnswer: 'Venice',
    difficulty: 'easy'
  },
  {
    id: 'geo-006',
    category: 'geography',
    text: 'What is the only country that borders both France and the United Kingdom?',
    correctAnswer: 'None',
    difficulty: 'hard'
  },
  {
    id: 'geo-007',
    category: 'geography',
    text: 'What is the capital of Australia?',
    correctAnswer: 'Canberra',
    difficulty: 'medium'
  },
  {
    id: 'geo-008',
    category: 'geography',
    text: 'What country has the most time zones?',
    correctAnswer: 'France',
    difficulty: 'hard'
  },
  {
    id: 'geo-009',
    category: 'geography',
    text: 'What is the tallest mountain in the world measured from base to peak?',
    correctAnswer: 'Mauna Kea',
    difficulty: 'hard'
  },
  {
    id: 'geo-010',
    category: 'geography',
    text: 'What two countries share the longest international border?',
    correctAnswer: 'Canada and United States',
    difficulty: 'medium'
  },

  // ============================================================================
  // ENTERTAINMENT (10 questions)
  // ============================================================================
  {
    id: 'ent-001',
    category: 'entertainment',
    text: 'What was the first feature-length animated movie?',
    correctAnswer: 'Snow White and the Seven Dwarfs',
    difficulty: 'medium'
  },
  {
    id: 'ent-002',
    category: 'entertainment',
    text: 'What was the first video game ever made?',
    correctAnswer: 'Tennis for Two',
    difficulty: 'hard'
  },
  {
    id: 'ent-003',
    category: 'entertainment',
    text: 'What was Mario\'s original name in Donkey Kong?',
    correctAnswer: 'Jumpman',
    difficulty: 'medium'
  },
  {
    id: 'ent-004',
    category: 'entertainment',
    text: 'What is the highest-grossing film of all time (not adjusted for inflation)?',
    correctAnswer: 'Avatar',
    difficulty: 'medium'
  },
  {
    id: 'ent-005',
    category: 'entertainment',
    text: 'What TV show has won the most Emmy Awards?',
    correctAnswer: 'Saturday Night Live',
    difficulty: 'hard'
  },
  {
    id: 'ent-006',
    category: 'entertainment',
    text: 'What was the first song played on MTV?',
    correctAnswer: 'Video Killed the Radio Star',
    difficulty: 'medium'
  },
  {
    id: 'ent-007',
    category: 'entertainment',
    text: 'What is the best-selling video game of all time?',
    correctAnswer: 'Minecraft',
    difficulty: 'easy'
  },
  {
    id: 'ent-008',
    category: 'entertainment',
    text: 'What was the first movie to make over $1 billion at the box office?',
    correctAnswer: 'Titanic',
    difficulty: 'medium'
  },
  {
    id: 'ent-009',
    category: 'entertainment',
    text: 'What color is Pac-Man?',
    correctAnswer: 'Yellow',
    difficulty: 'easy'
  },
  {
    id: 'ent-010',
    category: 'entertainment',
    text: 'What was the original name of the band Queen?',
    correctAnswer: 'Smile',
    difficulty: 'hard'
  },

  // ============================================================================
  // SPORTS (5 questions)
  // ============================================================================
  {
    id: 'spo-001',
    category: 'sports',
    text: 'How many dimples are on a regulation golf ball?',
    correctAnswer: '336',
    difficulty: 'hard'
  },
  {
    id: 'spo-002',
    category: 'sports',
    text: 'What sport was invented by James Naismith?',
    correctAnswer: 'Basketball',
    difficulty: 'easy'
  },
  {
    id: 'spo-003',
    category: 'sports',
    text: 'How long is an Olympic swimming pool in meters?',
    correctAnswer: '50 meters',
    difficulty: 'medium'
  },
  {
    id: 'spo-004',
    category: 'sports',
    text: 'What country has won the most FIFA World Cups?',
    correctAnswer: 'Brazil',
    difficulty: 'easy'
  },
  {
    id: 'spo-005',
    category: 'sports',
    text: 'What is the only sport to have been played on the moon?',
    correctAnswer: 'Golf',
    difficulty: 'medium'
  },

  // ============================================================================
  // FOOD & DRINK (10 questions)
  // ============================================================================
  {
    id: 'food-001',
    category: 'food',
    text: 'What is the most expensive spice in the world by weight?',
    correctAnswer: 'Saffron',
    difficulty: 'medium'
  },
  {
    id: 'food-002',
    category: 'food',
    text: 'What country consumes the most coffee per capita?',
    correctAnswer: 'Finland',
    difficulty: 'hard'
  },
  {
    id: 'food-003',
    category: 'food',
    text: 'What fruit is the most popular in the world?',
    correctAnswer: 'Tomato',
    difficulty: 'medium'
  },
  {
    id: 'food-004',
    category: 'food',
    text: 'What was Coca-Cola\'s original color?',
    correctAnswer: 'Green',
    difficulty: 'hard'
  },
  {
    id: 'food-005',
    category: 'food',
    text: 'What is the only food that never expires?',
    correctAnswer: 'Honey',
    difficulty: 'medium'
  },
  {
    id: 'food-006',
    category: 'food',
    text: 'What nut is used to make marzipan?',
    correctAnswer: 'Almonds',
    difficulty: 'easy'
  },
  {
    id: 'food-007',
    category: 'food',
    text: 'What country invented french fries?',
    correctAnswer: 'Belgium',
    difficulty: 'medium'
  },
  {
    id: 'food-008',
    category: 'food',
    text: 'What percentage of a cucumber is water?',
    correctAnswer: '95 percent',
    difficulty: 'hard'
  },
  {
    id: 'food-009',
    category: 'food',
    text: 'What is the main ingredient in traditional Japanese miso soup?',
    correctAnswer: 'Fermented soybeans',
    difficulty: 'medium'
  },
  {
    id: 'food-010',
    category: 'food',
    text: 'What was the first food eaten in space?',
    correctAnswer: 'Applesauce',
    difficulty: 'hard'
  },

  // ============================================================================
  // WEIRD FACTS (10 questions)
  // ============================================================================
  {
    id: 'weird-001',
    category: 'weird',
    text: 'What is a group of flamingos called?',
    correctAnswer: 'A flamboyance',
    difficulty: 'medium'
  },
  {
    id: 'weird-002',
    category: 'weird',
    text: 'How many years can a snail sleep?',
    correctAnswer: 'Three years',
    difficulty: 'hard'
  },
  {
    id: 'weird-003',
    category: 'weird',
    text: 'What is the national animal of Scotland?',
    correctAnswer: 'Unicorn',
    difficulty: 'medium'
  },
  {
    id: 'weird-004',
    category: 'weird',
    text: 'How many noses does a slug have?',
    correctAnswer: 'Four',
    difficulty: 'hard'
  },
  {
    id: 'weird-005',
    category: 'weird',
    text: 'What is the only letter that doesn\'t appear in any U.S. state name?',
    correctAnswer: 'Q',
    difficulty: 'hard'
  },
  {
    id: 'weird-006',
    category: 'weird',
    text: 'What do you call a group of owls?',
    correctAnswer: 'A parliament',
    difficulty: 'medium'
  },
  {
    id: 'weird-007',
    category: 'weird',
    text: 'What animal cannot stick out its tongue?',
    correctAnswer: 'Crocodile',
    difficulty: 'medium'
  },
  {
    id: 'weird-008',
    category: 'weird',
    text: 'What is the dot over the letter "i" called?',
    correctAnswer: 'A tittle',
    difficulty: 'hard'
  },
  {
    id: 'weird-009',
    category: 'weird',
    text: 'What is a jiffy actually measuring?',
    correctAnswer: 'One hundredth of a second',
    difficulty: 'hard'
  },
  {
    id: 'weird-010',
    category: 'weird',
    text: 'What is the fear of peanut butter sticking to the roof of your mouth called?',
    correctAnswer: 'Arachibutyrophobia',
    difficulty: 'hard'
  }
];

/**
 * Get a random question that hasn't been used yet
 */
export function getRandomQuestion(
  usedIds: string[],
  category: QuestionCategory = 'random'
): Question | null {
  const available = QUESTIONS.filter(q =>
    !usedIds.includes(q.id) &&
    (category === 'random' || q.category === category)
  );

  if (available.length === 0) {
    // If no questions available in category, fall back to random
    if (category !== 'random') {
      return getRandomQuestion(usedIds, 'random');
    }
    return null;
  }

  const randomIndex = Math.floor(Math.random() * available.length);
  return available[randomIndex];
}

/**
 * Get count of available questions per category
 */
export function getQuestionCounts(): Record<QuestionCategory, number> {
  const counts: Record<QuestionCategory, number> = {
    history: 0,
    science: 0,
    geography: 0,
    entertainment: 0,
    sports: 0,
    food: 0,
    weird: 0,
    random: QUESTIONS.length
  };

  for (const q of QUESTIONS) {
    if (q.category in counts) {
      counts[q.category]++;
    }
  }

  return counts;
}
