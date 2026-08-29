import { AccountAccess } from './account-access';

interface DescribeIdeaPlaceholderProps {
  searchParams: Promise<{ project?: string }>;
}

export default async function DescribeIdeaPlaceholder({
  searchParams,
}: DescribeIdeaPlaceholderProps) {
  const { project } = await searchParams;
  return (
    <main>
      <section className="foundation-card" aria-labelledby="describe-title">
        <p className="eyebrow">Step 2 of 5 · Describe Your Idea</p>
        <h1 id="describe-title">Your product selection is saved.</h1>
        <p>
          Your project is ready for artwork creation. Once you have a design, you can make it yours
          in the editor.
        </p>
        {project ? (
          <a className="continue" href={`/editor?project=${encodeURIComponent(project)}`}>
            Make It Yours
          </a>
        ) : null}
        <AccountAccess />
      </section>
    </main>
  );
}
