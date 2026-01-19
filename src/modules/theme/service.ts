import { prisma } from "../../Models/context";

export class AnnualThemeService {
  async create(data: {
    year: number | string;
    title: string;
    verseReference: string;
    verse: string;
    message: string;
    imageUrl?: string;
    isActive?: boolean;
  }) {
    if (data.isActive) {
      await prisma.annualTheme.updateMany({
        data: { isActive: false },
      });
    }

    const result = await prisma.annualTheme.create({
      data: {
        year: Number(data.year),
        title: data.title,
        verseReference: data.verseReference,
        verse: data.verse,
        message: data.message,
        imageUrl: data.imageUrl,
        isActive: data.isActive
      },
    });
  }

  async findAll() {
    return prisma.annualTheme.findMany({
      orderBy: { year: "desc" },
    });
  }

  async findActive() {
    return prisma.annualTheme.findFirst({
      where: { isActive: true },
    });
  }

  async findById(id: number) {
    return prisma.annualTheme.findUnique({
      where: { id },
    });
  }

  async update(
    id: number,
    data: Partial<{
      year: string | number;
      title: string;
      verseReference: string;
      verse: string;
      message: string;
      imageUrl: string;
      isActive: boolean;
    }>
  ) {
    if (data.isActive) {
      await prisma.annualTheme.updateMany({
        where: { id: { not: id } },
        data: { isActive: false },
      });
    }

    return prisma.annualTheme.update({
      where: { id },
      data:{
        ...data,
        year: data.year ? Number(data.year) : undefined
      },
    });
  }

  async delete(id: number) {
    return prisma.annualTheme.delete({
      where: { id },
    });
  }
}
