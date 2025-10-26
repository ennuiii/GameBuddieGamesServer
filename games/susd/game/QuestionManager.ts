import { Question } from '../types/types.js';

export class QuestionManager {
  private personalQuestions: Question[] = [];
  private comparativeQuestions: Question[] = [];

  loadQuestions(personalQuestions: Question[], comparativeQuestions: Question[], hypotheticalQuestions?: Question[]) {
    this.personalQuestions = personalQuestions;
    this.comparativeQuestions = comparativeQuestions;
    console.log(`[QuestionManager] Loaded ${personalQuestions.length} personal and ${comparativeQuestions.length} comparative questions`);
  }

  getRandomPersonalQuestion(usedQuestions: Set<string>): Question {
    const availableQuestions = this.personalQuestions.filter(q => !usedQuestions.has(q.id));
    
    if (availableQuestions.length === 0) {
      console.log('[QuestionManager] All personal questions used, resetting pool');
      return this.personalQuestions[Math.floor(Math.random() * this.personalQuestions.length)];
    }
    
    return availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
  }

  getRandomComparativeQuestion(usedQuestions: Set<string>): Question {
    const availableQuestions = this.comparativeQuestions.filter(q => !usedQuestions.has(q.id));
    
    if (availableQuestions.length === 0) {
      console.log('[QuestionManager] All comparative questions used, resetting pool');
      return this.comparativeQuestions[Math.floor(Math.random() * this.comparativeQuestions.length)];
    }
    
    return availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
  }

  getRandomQuestion(usedQuestions: Set<string>): Question {
    // Randomly choose between personal and comparative questions
    const categories = ['personal', 'comparative'];
    const category = categories[Math.floor(Math.random() * categories.length)];
    
    switch (category) {
      case 'personal':
        return this.getRandomPersonalQuestion(usedQuestions);
      case 'comparative':
        return this.getRandomComparativeQuestion(usedQuestions);
      default:
        return this.getRandomPersonalQuestion(usedQuestions);
    }
  }

  getAllQuestions(): Question[] {
    return [...this.personalQuestions, ...this.comparativeQuestions];
  }

  getQuestionById(questionId: string): Question | undefined {
    const allQuestions = this.getAllQuestions();
    return allQuestions.find(q => q.id === questionId);
  }

  getAvailableQuestionsCount(usedQuestions: Set<string>): number {
    return this.getAllQuestions().filter(q => !usedQuestions.has(q.id)).length;
  }
} 