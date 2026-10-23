-- Full-text search: a GENERATED column keeps the vector in sync with question/answer automatically
-- (no triggers, no app code). Question is weighted A, answer B, so title matches rank higher.
-- The 'english' config gives stemming ("resetting" matches "reset") and stop-word removal.
ALTER TABLE "FaqArticle" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("question", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("answer", '')), 'B')
  ) STORED;

-- CreateTable
CREATE TABLE "FaqVote" (
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqVote_pkey" PRIMARY KEY ("articleId","userId")
);

-- CreateIndex
CREATE INDEX "FaqVote_userId_idx" ON "FaqVote"("userId");

-- CreateIndex
CREATE INDEX "FaqArticle_searchVector_idx" ON "FaqArticle" USING GIN ("searchVector");

-- AddForeignKey
ALTER TABLE "FaqVote" ADD CONSTRAINT "FaqVote_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "FaqArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqVote" ADD CONSTRAINT "FaqVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
