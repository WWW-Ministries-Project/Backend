/*
  Community rich text.

  Post and comment bodies may now be sanitized HTML from the mobile rich-text
  editor (up to 20,000 characters of markup for 5,000 visible ones). TEXT
  holds 65,535 bytes, which 20,000 utf8mb4 characters can exceed, so comment
  bodies widen to MEDIUMTEXT like post bodies (already LONGTEXT). Widening
  keeps every existing row; plain-text bodies stay valid as they are.
*/

-- AlterTable
ALTER TABLE `community_comment` MODIFY `body` MEDIUMTEXT NOT NULL;
