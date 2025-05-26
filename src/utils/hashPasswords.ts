import bcrypt from "bcryptjs";

export const hashPassword = async (password: string) => {
  const salt = bcrypt.genSaltSync(10);
  return await bcrypt.hashSync(password, salt);
};

export const comparePassword = async (
  password: string,
  hashedPassword: string,
) => {
  return await bcrypt.compareSync(password, hashedPassword);
};

export const toISODate = (dateValue: any): Date | null => {
  if (!dateValue) return null; // Handle undefined/null values

  const parsedDate = new Date(dateValue);
  return isNaN(parsedDate.getTime()) ? null : parsedDate; // Ensure it's a valid date
};
