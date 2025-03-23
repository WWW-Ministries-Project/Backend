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
