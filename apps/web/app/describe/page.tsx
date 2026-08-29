import { AccountAccess } from './account-access';

export default function DescribeIdeaPlaceholder() {
  return (
    <main>
      <section className="foundation-card" aria-labelledby="describe-title">
        <p className="eyebrow">Step 2 of 5 · Describe Your Idea</p>
        <h1 id="describe-title">Your product selection is saved.</h1>
        <p>Design generation arrives in Milestone 2. No artwork has been generated yet.</p>
        <AccountAccess />
      </section>
    </main>
  );
}
