import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  startOfDay,
  startOfWeek,
} from "date-fns";

export function generateRecurringDates(
  startDate: string,
  endDate: string,
  recurring: any
): any {
  const { frequency, interval, daysOfWeek, dayOfMonth, monthOfYear }: any =
    recurring;
  let dates: any = [];
  let currentDate: any = startOfWeek(new Date(startDate), { weekStartsOn: 1 });

  let currentWeekDay: any;
  let currentMonthDay: any;

  // Adjust the start date if it's after the end date
  if (currentDate > new Date(endDate)) {
    return dates;
  }

  while (currentDate <= new Date(endDate)) {
    // Check if the current date matches the recurrence pattern
    switch (frequency) {
      case "daily":
        currentDate = addDays(currentDate, recurring.interval);
        dates.push(currentDate);
        break;

      case "weekly":
        recurring.daysOfWeek.map((day: number) => {
          let newshi: Date = addDays(currentDate, day);
          currentWeekDay = newshi;
          dates.push(newshi);
        });
        currentDate = addWeeks(currentDate, recurring.interval);
        break;

      case "monthly":
        recurring.dayOfMonth.map((day: number) => {
          let newshi: Date = addDays(currentDate, day);
          currentMonthDay = newshi;
          dates.push(newshi);
        });
        currentDate = addMonths(currentDate, interval);
        break;

      // case "yearly":
      //   if (
      //     currentDate.getMonth() === monthOfYear &&
      //     currentDate.getDate() === startDate.getDate()
      //   ) {
      //     dates.push(new Date(currentDate));
      //   }
      //   currentDate = addYears(currentDate, interval);
      //   break;

      default:
        break;
    }
  }

  return dates;
}
