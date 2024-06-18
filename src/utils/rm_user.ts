import { prisma } from "./../Models/context";

const jackshit = async () => {
  try {
    let d1: any = [];
    const data = await prisma.user.findMany({
      where: {
        name: {
          contains: "{{$randomFirstName {{$randomLastName {{$randomLastName",
        },
      },
    });
    data.map((d2) => {
      d1.push(d2.id);
    });
    console.log(d1);
    await prisma.user.deleteMany({
      where: {
        id: {
          in: d1,
        },
      },
    });
    await prisma.user_info.deleteMany({
      where: {
        user_id: {
          in: d1,
        },
      },
    });
    await prisma.user_departments.deleteMany({
      where: {
        user_id: {
          in: d1,
        },
      },
    });
    await prisma.event_attendance.deleteMany({
      where: {
        user_id: {
          in: d1,
        },
      },
    });
  } catch (error) {
    return error;
  }
};

jackshit();
