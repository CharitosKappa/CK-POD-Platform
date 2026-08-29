import { AccountAccess } from './account-access';
import { GuidedCreation } from './guided-creation';

interface DescribeIdeaPlaceholderProps {
  searchParams: Promise<{ project?: string }>;
}

export default async function DescribeIdeaPlaceholder({
  searchParams,
}: DescribeIdeaPlaceholderProps) {
  const { project } = await searchParams;
  return (
    <main>
      <section className="foundation-card" aria-label="Guided creation">
        {project ? (
          <GuidedCreation projectId={project} />
        ) : (
          <p>Choose a product before describing your idea.</p>
        )}
        <AccountAccess />
      </section>
    </main>
  );
}
