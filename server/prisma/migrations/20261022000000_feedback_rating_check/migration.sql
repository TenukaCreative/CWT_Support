-- Ratings are 1..5. The API validates this too, but the database is the last line of defence
-- (Prisma cannot express CHECK constraints in the schema, so this lives in raw SQL).
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
