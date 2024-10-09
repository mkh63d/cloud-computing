/*
  Warnings:

  - Added the required column `size` to the `File` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "File" ADD COLUMN     "size" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "ServiceActionLog" ADD COLUMN     "fileId" INTEGER;

-- AddForeignKey
ALTER TABLE "ServiceActionLog" ADD CONSTRAINT "ServiceActionLog_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
