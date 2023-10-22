-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "gender" TEXT NOT NULL,
    "primary_number" TEXT,
    "other_number" TEXT,
    "email" TEXT,
    "address" TEXT,
    "country" TEXT,
    "occupation" TEXT,
    "company" TEXT,
    "member_since" TIMESTAMP(3),
    "photo" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "partner" BOOLEAN DEFAULT false,
    "is_user" BOOLEAN,
    "is_visitor" BOOLEAN,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "department_head" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_departments" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "department_id" INTEGER,

    CONSTRAINT "user_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" INTEGER,
    "description" TEXT,

    CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
