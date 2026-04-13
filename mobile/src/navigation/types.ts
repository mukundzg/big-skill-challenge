export type RootStackParamList = {
  Splash: undefined;
  /** Email entry / registration: set `fromUserNotFound` when server has no user row. */
  Landing: { fromUserNotFound?: boolean };
  VerifyCode: { email: string };
  Home: undefined;
  /** Quiz dashboard after consents (default landing when consents already accepted) */
  QuizHome: undefined;
  /** Server starts attempt and returns first question (DB-backed bank) */
  QuizPrepare: { email: string };
  QuizPlay: {
    attemptId: number;
    totalQuestions: number;
    timePerQuestionSeconds: number;
    marksPerQuestion: number;
    initialQuestion: { index: number; question: string; options: string[] };
  };
  /** All questions in the attempt answered correctly */
  QuizComplete: undefined;
  InactiveAccount: { email: string };
};
