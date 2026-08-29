import { AccountAccess } from './account-access';

export default function DescribeIdeaPlaceholder() {
  return (
    <main>
      <section className="foundation-card" aria-labelledby="describe-title">
        <p className="eyebrow">Step 2 of 5 · Describe Your Idea</p>
        <h1 id="describe-title">Your product selection is saved.</h1>
        <p>
          Your project is ready for artwork creation. The visual editor arrives in a later
          milestone.
        </p>
        <AccountAccess />
      </section>
    </main>
  );
}
