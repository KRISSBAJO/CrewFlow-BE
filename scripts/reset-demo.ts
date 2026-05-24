import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const demoSlugs = ['sparkle-home-services', 'crewflow-platform'];

async function main() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_DEMO_SEED !== 'true'
  ) {
    throw new Error(
      'Refusing to reset demo data in production. Set ALLOW_DEMO_SEED=true only for disposable production-like environments.',
    );
  }

  const tenants = await prisma.tenant.findMany({
    where: { slug: { in: demoSlugs } },
    select: { id: true, slug: true, businessName: true },
  });

  if (!tenants.length) {
    console.log('No CrewFlow demo tenants found to reset.');
    return;
  }

  await prisma.tenant.deleteMany({
    where: { id: { in: tenants.map((tenant) => tenant.id) } },
  });

  console.log(
    `Deleted ${tenants.length} demo tenant(s): ${tenants
      .map((tenant) => tenant.slug)
      .join(', ')}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
