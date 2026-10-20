/*
  Life centers: back to the original attendance model.

  Meeting attendees are souls won only (life_center_meeting_attendee with
  isFirstTimer). Member attendance from 20261025120000_life_centers_redesign
  is dropped along with its rows. Forward-only.
*/

-- DropForeignKey
ALTER TABLE `life_center_meeting_member` DROP FOREIGN KEY `life_center_meeting_member_meetingId_fkey`;

-- DropForeignKey
ALTER TABLE `life_center_meeting_member` DROP FOREIGN KEY `life_center_meeting_member_userId_fkey`;

-- DropTable
DROP TABLE `life_center_meeting_member`;
