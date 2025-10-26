import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class QuestionManager {
  constructor() {
    this.questionsFile = path.join(__dirname, '../data/questions.json');
    this.questions = this.loadQuestions();
    
    // Hidden categories that should only appear if explicitly selected
    this.HIDDEN_CATEGORIES = ['League of Legends'];
  }

  loadQuestions() {
    try {
      if (fs.existsSync(this.questionsFile)) {
        const data = fs.readFileSync(this.questionsFile, 'utf8');
        return JSON.parse(data);
      } else {
        // Create default questions if file doesn't exist
        const defaultQuestions = this.getDefaultQuestions();
        this.saveQuestions(defaultQuestions);
        return defaultQuestions;
      }
    } catch (error) {
      console.error('Error loading questions:', error);
      return this.getDefaultQuestions();
    }
  }

  saveQuestions(questions) {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.questionsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.questionsFile, JSON.stringify(questions, null, 2));
      this.questions = questions;
    } catch (error) {
      console.error('Error saving questions:', error);
    }
  }

  getAllQuestions() {
    return this.questions;
  }

  // Get questions filtered by categories, with special handling for hidden categories
  getQuestionsByCategories(selectedCategories = []) {
    // If no categories selected, return all questions EXCEPT hidden categories
    if (!selectedCategories || selectedCategories.length === 0) {
      return this.questions.filter(q => {
        const category = q.category || 'General';
        return !this.HIDDEN_CATEGORIES.includes(category);
      });
    }
    
    // If categories are selected, return only questions from those categories
    return this.questions.filter(q => {
      const category = q.category || 'General';
      return selectedCategories.includes(category);
    });
  }

  // Get visible categories (excluding hidden ones)
  getVisibleCategories() {
    const allCategories = [...new Set(this.questions.map(q => q.category || 'General'))];
    return allCategories.filter(category => !this.HIDDEN_CATEGORIES.includes(category));
  }

  // Get all categories including hidden ones
  getAllCategories() {
    return [...new Set(this.questions.map(q => q.category || 'General'))];
  }

  // Get questions sorted by bad mark count (for admin interface)
  getQuestionsByBadMarkCount(sortOrder = 'desc') {
    // Initialize badMarkCount for questions that don't have it
    this.questions.forEach(question => {
      if (!question.badMarkCount) {
        question.badMarkCount = 0;
      }
    });

    const sorted = [...this.questions].sort((a, b) => {
      const countA = a.badMarkCount || 0;
      const countB = b.badMarkCount || 0;
      
      if (sortOrder === 'desc') {
        return countB - countA; // Highest count first
      } else {
        return countA - countB; // Lowest count first
      }
    });

    return sorted;
  }

  // Get statistics about bad questions
  getBadQuestionStats() {
    const stats = {
      totalQuestions: this.questions.length,
      questionsMarkedBad: 0,
      totalBadMarks: 0,
      averageBadMarks: 0,
      mostMarkedQuestion: null,
      mostMarkedCount: 0
    };

    this.questions.forEach(question => {
      const badMarkCount = question.badMarkCount || 0;
      
      if (badMarkCount > 0) {
        stats.questionsMarkedBad++;
        stats.totalBadMarks += badMarkCount;
        
        if (badMarkCount > stats.mostMarkedCount) {
          stats.mostMarkedCount = badMarkCount;
          stats.mostMarkedQuestion = {
            id: question.id,
            question: question.question,
            badMarkCount: badMarkCount
          };
        }
      }
    });

    if (stats.questionsMarkedBad > 0) {
      stats.averageBadMarks = stats.totalBadMarks / stats.questionsMarkedBad;
    }

    return stats;
  }

  getQuestion(id) {
    return this.questions.find(q => q.id === id);
  }

  // Get random question with category filtering
  getRandomQuestion(selectedCategories = []) {
    const availableQuestions = this.getQuestionsByCategories(selectedCategories);
    if (availableQuestions.length === 0) return null;
    
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    return availableQuestions[randomIndex];
  }

  addQuestion(questionData) {
    const question = {
      id: uuidv4(),
      type: questionData.type || 'normal',
      question: questionData.question,
      answer: questionData.answer || '',
      category: questionData.category || 'General',
      difficulty: questionData.difficulty || 'medium'
    };

    this.questions.push(question);
    this.saveQuestions(this.questions);
    return question;
  }

  updateQuestion(id, updateData) {
    const index = this.questions.findIndex(q => q.id === id);
    if (index === -1) return null;

    this.questions[index] = {
      ...this.questions[index],
      ...updateData,
      id // Ensure ID doesn't change
    };

    this.saveQuestions(this.questions);
    return this.questions[index];
  }

  deleteQuestion(id) {
    const index = this.questions.findIndex(q => q.id === id);
    if (index === -1) return false;

    this.questions.splice(index, 1);
    this.saveQuestions(this.questions);
    return true;
  }

  markQuestionAsBad(id, isBad = true) {
    const index = this.questions.findIndex(q => q.id === id);
    if (index === -1) return null;

    // Initialize badMarkCount if it doesn't exist
    if (!this.questions[index].badMarkCount) {
      this.questions[index].badMarkCount = 0;
    }

    if (isBad) {
      // Increment the counter when marking as bad
      this.questions[index].badMarkCount++;
      this.questions[index].isBad = this.questions[index].badMarkCount > 0;
      console.log(`Question ${id} marked as bad (count: ${this.questions[index].badMarkCount})`);
    } else {
      // Reset when marking as good
      this.questions[index].badMarkCount = 0;
      this.questions[index].isBad = false;
      console.log(`Question ${id} marked as good (count reset to 0)`);
    }

    this.saveQuestions(this.questions);
    return {
      ...this.questions[index],
      success: true,
      badMarkCount: this.questions[index].badMarkCount,
      isBad: this.questions[index].isBad
    };
  }

  // Delete multiple questions by ID
  deleteMultipleQuestions(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { success: false, deletedCount: 0 };
    
    const initialCount = this.questions.length;
    this.questions = this.questions.filter(question => !ids.includes(question.id));
    const deletedCount = initialCount - this.questions.length;
    
    this.saveQuestions(this.questions);
    return { success: true, deletedCount };
  }

  // Delete all questions in specific categories
  deleteQuestionsByCategory(categories) {
    if (!Array.isArray(categories) || categories.length === 0) return { success: false, deletedCount: 0 };
    
    const initialCount = this.questions.length;
    this.questions = this.questions.filter(question => {
      const category = question.category || 'General';
      return !categories.includes(category);
    });
    
    const deletedCount = initialCount - this.questions.length;
    this.saveQuestions(this.questions);
    return { success: true, deletedCount };
  }

  // Find similar/duplicate questions
  findSimilarQuestions() {
    const similarGroups = [];
    const questionMap = new Map();
    
    // Normalize text for comparison
    const normalizeText = (text) => {
      return text.toLowerCase().trim().replace(/[^\w\s]/g, '');
    };
    
    // Group questions by normalized question text
    this.questions.forEach(question => {
      const normalizedQuestion = normalizeText(question.question);
      if (!questionMap.has(normalizedQuestion)) {
        questionMap.set(normalizedQuestion, []);
      }
      questionMap.get(normalizedQuestion).push(question);
    });
    
    // Filter out groups with more than one question (i.e., similar questions)
    questionMap.forEach((questions, normalizedText) => {
      if (questions.length > 1) {
        similarGroups.push(questions);
      }
    });
    
    // Also find questions with similar answers
    const answerMap = new Map();
    this.questions.forEach(question => {
      const normalizedAnswer = normalizeText(question.answer);
      if (!answerMap.has(normalizedAnswer)) {
        answerMap.set(normalizedAnswer, []);
      }
      answerMap.get(normalizedAnswer).push(question);
    });
    
    // Add groups with the same answer but different questions
    answerMap.forEach((questions, normalizedAnswer) => {
      if (questions.length > 1) {
        // Check if this group is a subset of an already identified group
        const isNewGroup = !similarGroups.some(group => 
          questions.every(q => group.some(gq => gq.id === q.id))
        );
        
        if (isNewGroup) {
          similarGroups.push(questions);
        }
      }
    });
    
    return similarGroups;
  }

  // Find exact duplicate questions (identical in all fields)
  findExactDuplicates() {
    const duplicateGroups = [];
    const questionMap = new Map();
    
    // Create a unique key for each question based on all its properties
    const createQuestionKey = (question) => {
      const normalizeText = (text) => text.toLowerCase().trim();
      return `${normalizeText(question.question)}|${normalizeText(question.answer)}|${normalizeText(question.category || 'General')}|${(question.difficulty || 'medium').toLowerCase()}`;
    };
    
    // Group questions by their unique key
    this.questions.forEach(question => {
      const key = createQuestionKey(question);
      if (!questionMap.has(key)) {
        questionMap.set(key, []);
      }
      questionMap.get(key).push(question);
    });
    
    // Filter out groups with more than one question (i.e., exact duplicates)
    questionMap.forEach((questions, key) => {
      if (questions.length > 1) {
        duplicateGroups.push(questions);
      }
    });
    
    return duplicateGroups;
  }

  // Delete exact duplicates, keeping only one of each
  deleteExactDuplicates() {
    const duplicateGroups = this.findExactDuplicates();
    let totalDeleted = 0;
    const deletedIds = [];
    
    duplicateGroups.forEach(group => {
      // Keep the first question in each group, delete the rest
      const toKeep = group[0];
      const toDelete = group.slice(1);
      
      toDelete.forEach(question => {
        deletedIds.push(question.id);
        totalDeleted++;
      });
    });
    
    if (deletedIds.length > 0) {
      // Remove the duplicate questions
      this.questions = this.questions.filter(question => !deletedIds.includes(question.id));
      this.saveQuestions(this.questions);
    }
    
    return {
      success: true,
      deletedCount: totalDeleted,
      duplicateGroupsFound: duplicateGroups.length,
      deletedIds
    };
  }

  getDefaultQuestions() {
    return [
      {
        id: "q1",
        type: "normal",
        question: "What is the capital of Germany?",
        answer: "Berlin",
        category: "Geography",
        difficulty: "easy"
      },
      {
        id: "q2",
        type: "normal",
        question: "Which planet is known as the Red Planet?",
        answer: "Mars",
        category: "Science",
        difficulty: "easy"
      },
      {
        id: "q3",
        type: "normal",
        question: "Who painted the Mona Lisa?",
        answer: "Leonardo da Vinci",
        category: "Art",
        difficulty: "medium"
      },
      {
        id: "q4",
        type: "normal",
        question: "What is the largest ocean on Earth?",
        answer: "Pacific Ocean",
        category: "Geography",
        difficulty: "easy"
      },
      {
        id: "q5",
        type: "normal",
        question: "In what year did World War II end?",
        answer: "1945",
        category: "History",
        difficulty: "medium"
      },
      {
        id: "q6",
        type: "normal",
        question: "What is the chemical symbol for gold?",
        answer: "Au",
        category: "Science",
        difficulty: "medium"
      },
      {
        id: "q7",
        type: "normal",
        question: "Which Shakespeare play features the characters Romeo and Juliet?",
        answer: "Romeo and Juliet",
        category: "Literature",
        difficulty: "easy"
      },
      {
        id: "q8",
        type: "normal",
        question: "What is the smallest country in the world?",
        answer: "Vatican City",
        category: "Geography",
        difficulty: "medium"
      },
      {
        id: "q9",
        type: "normal",
        question: "Who developed the theory of relativity?",
        answer: "Albert Einstein",
        category: "Science",
        difficulty: "medium"
      },
      {
        id: "q10",
        type: "normal",
        question: "What is the hardest natural substance on Earth?",
        answer: "Diamond",
        category: "Science",
        difficulty: "medium"
      },
      {
        id: "q11",
        type: "normal",
        question: "Which mammal is known to have the most powerful bite in the world?",
        answer: "Hippopotamus",
        category: "Nature",
        difficulty: "hard"
      },
      {
        id: "q12",
        type: "normal",
        question: "What does 'www' stand for in a website address?",
        answer: "World Wide Web",
        category: "Technology",
        difficulty: "easy"
      },
      {
        id: "q13",
        type: "normal",
        question: "How many chambers does a human heart have?",
        answer: "Four",
        category: "Science",
        difficulty: "medium"
      },
      {
        id: "q14",
        type: "normal",
        question: "Which element has the chemical symbol 'O'?",
        answer: "Oxygen",
        category: "Science",
        difficulty: "easy"
      },
      {
        id: "q15",
        type: "normal",
        question: "What is the longest river in the world?",
        answer: "Nile River",
        category: "Geography",
        difficulty: "medium"
      },
      // Hidden League of Legends questions
      {
        id: "lol1",
        type: "normal",
        question: "Which champion is known as 'The Blind Monk'?",
        answer: "Lee Sin",
        category: "League of Legends",
        difficulty: "easy"
      },
      {
        id: "lol2",
        type: "normal",
        question: "What is the name of the map in League of Legends?",
        answer: "Summoner's Rift",
        category: "League of Legends",
        difficulty: "easy"
      },
      {
        id: "lol3",
        type: "normal",
        question: "Which item gives the most Ability Power?",
        answer: "Rabadon's Deathcap",
        category: "League of Legends",
        difficulty: "medium"
      },
      {
        id: "lol4",
        type: "normal",
        question: "What does 'ADC' stand for?",
        answer: "Attack Damage Carry",
        category: "League of Legends",
        difficulty: "easy"
      },
      {
        id: "lol5",
        type: "normal",
        question: "Which dragon provides the strongest late-game buff?",
        answer: "Elder Dragon",
        category: "League of Legends",
        difficulty: "medium"
      }
    ];
  }
}

export default QuestionManager; 