import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const rows = await prisma.therapist.findMany({
    where: {
      displayName: { in: ["美咲", "清澄せいら"] }
    },
    select: {
      displayName: true,
      profile: true,
      specialties: true,
      nominationFee: true
    },
    orderBy: { displayName: "asc" }
  });

  console.log(JSON.stringify({
    ok: rows.length >= 2,
    rows: rows.map((row) => ({
      displayName: row.displayName,
      profileLength: row.profile ? row.profile.length : 0,
      hasStructuredProfile: /性格[:：]/u.test(row.profile ?? "") && /対応範囲[:：]/u.test(row.profile ?? ""),
      specialties: row.specialties,
      nominationFee: row.nominationFee
    }))
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
