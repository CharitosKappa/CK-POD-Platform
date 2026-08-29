# Project Let It Be — CEO Requirements Questionnaire

> **Σκοπός:** Το παρόν document αποτελεί το βασικό CEO briefing και το source of truth για το Project Let It Be.
>
> Συμπλήρωσε κάθε απάντηση ακριβώς κάτω από το `**CEO Answer:**`.
>
> Όπου χρειάζεται, μπορείς να χρησιμοποιείς τις παρακάτω ειδικές απαντήσεις:
>
> - `TEAM RECOMMENDATION` — ζητάς από τον αντίστοιχο specialist να προτείνει τη βέλτιστη λύση.
> - `TBD` — η απόφαση μεταφέρεται για αργότερα.
> - `NOT MVP` — feature/capability που θεωρούμε χρήσιμο, αλλά δεν ανήκει στο MVP scope.

---

# 0. Project Context

## Working Title
**Project Let It Be**

## Core Concept
AI-powered design generation platform όπου ο πελάτης μπορεί να δημιουργεί designs μέσω text prompts και image+text prompts, να τα επεξεργάζεται, να τα τοποθετεί σε physical products όπως T-shirts, να βλέπει preview του τελικού αποτελέσματος, να ολοκληρώνει την αγορά και η παραγγελία να δρομολογείται αυτόματα προς το Printify για production και fulfillment.

## Initial Team
- Founder / CEO
- CTO / Founding Engineer
- AI/ML Engineer — Generative Imaging
- Senior Frontend Engineer — Canvas / WebGL
- Product Designer — UX/UI
- Print Production / Prepress Specialist
- Fractional CFO
- Fractional IP Counsel

---

# 1. CTO / Founding Engineer — Architecture & Platform

### CTO-01 — Τι ακριβώς περιλαμβάνει το MVP;
**CEO Answer:** 
T-shirts
### CTO-02 — Σε ποια χώρα ή αγορά κάνουμε launch πρώτα;
**CEO Answer:** 
USA
### CTO-03 — Υποστηρίζουμε mobile + desktop από Day 1 ή ξεκινάμε desktop-first;
**CEO Answer:** 
Mobile + Desktop από Day 1
### CTO-04 — Επιτρέπεται guest checkout ή απαιτείται account;
**CEO Answer:** 
TEAM RECOMMENDATION
### CTO-05 — Πρέπει οι users να μπορούν να αποθηκεύουν projects;
**CEO Answer:** 
Εφόσον κάνει λογαριασμό, θα αποθηκεύονται τα projects του για ορισμένο χρονικό διάστημα. Πρέπει να το δούμε με CTO & CFO.
### CTO-06 — Πρέπει να μπορούν να επιστρέψουν μετά από εβδομάδες και να συνεχίσουν το editing;
**CEO Answer:** 
Αυτό θα εξαρτηθεί από τα cookies, το account και την απόφαση που θα πάρουμε σε σχέση με το CTO-05.
### CTO-07 — Θέλουμε version history για κάθε design;
**CEO Answer:** 
TEAM RECOMMENDATION
### CTO-08 — Πόσο βαθύ πρέπει να είναι το undo/redo history;
**CEO Answer:** 
TEAM RECOMMENDATION
### CTO-09 — Θέλουμε shareable design URLs;
**CEO Answer:** 
Ναι
### CTO-10 — Θέλουμε collaboration/shared editing αργότερα;
**CEO Answer:** 
Ίσως. NOT MVP
### CTO-11 — Θα πουλάμε μόνο physical products ή και downloadable artwork;
**CEO Answer:** 
Physical products
### CTO-12 — Θα υπάρχει marketplace/gallery με designs άλλων users;
**CEO Answer:** 
Ναι. Εδώ θέλω πρόταση από CFO και CTO για partnership με designers και ποσοστό επί των πωλήσεων.
### CTO-13 — Το checkout θα είναι native/custom, Shopify-based ή μέσω άλλου commerce backend;
**CEO Answer:** 
Η αρχική σκέψη είναι custom. Αλλά θέλω να μας πει ο CTO, τι δυνατότητα έχουμε με το Shopify-based.
### CTO-14 — Ποιο payment provider θέλουμε να χρησιμοποιήσουμε;
**CEO Answer:** 
Stripe. Εδώ θέλω τον CTO να προτείνει εναλλακτικές & τον CFO να δει τα payment fees.
### CTO-15 — Πρέπει να υποστηρίζουμε Apple Pay / Google Pay / PayPal;
**CEO Answer:** 
Apple Pay / Google Pay
### CTO-16 — Θέλουμε internal order-management admin;
**CEO Answer:** 
Ναι, για back-office εργασίες από τους διαχειριστές.
### CTO-17 — Στο launch, θέλουμε manual approval πριν μια παραγγελία σταλεί στο Printify;
**CEO Answer:** 
Ναι. Για αρχή τουλάχιστον θα περνάει από control. Αργότερα θα μπει ποσοστό εγκυρότητας και εφόσον είναι ένα ποσοστό και πάνω θα περνάει αυτόματα. Σκοπός είναι στο τέλος να περνάνε όλα αυτόματα.
### CTO-18 — Σε production/integration failure, θέλουμε automatic retry ή human review;
**CEO Answer:** 
Human review. Εδώ θα μας πει ο Print Production/Prepress Specialist από την εμπειρία του τι μπορεί να πάει στραβά.
### CTO-19 — Θέλουμε automatic Printify routing ή δικό μας routing engine;
**CEO Answer:** 
TEAM RECOMMENDATION.
### CTO-20 — Θα χρησιμοποιούμε ένα company Printify account ή θέλουμε αργότερα third-party merchant connections;
**CEO Answer:** 
Ένα εταιρικό Printify account.
### CTO-21 — Θέλουμε multi-provider fallback;
**CEO Answer:** 
Ναι. Εδώ ο CTO θα μας πει τεχνικά τι μπορεί να πάει στραβά. Το ίδιο και ο Print Production/Prepress Specialist.
### CTO-22 — Πόσο σημαντικό είναι το estimated delivery πριν το checkout;
**CEO Answer:** 
Πολύ σημαντικό για το conversion rate.
### CTO-23 — Θέλουμε real-time shipping rates;
**CEO Answer:** 
Ναι.
### CTO-24 — Τι scale πρέπει να υποστηρίζει άνετα η architecture στους πρώτους 12 μήνες;
**CEO Answer:** 
1000 order/month
### CTO-25 — Ποιο είναι το maximum acceptable AI generation time;
**CEO Answer:** 
TEAM RECOMMENDATION
### CTO-26 — Ποιο είναι το maximum acceptable editor load time;
**CEO Answer:** 
TEAM RECOMMENDATION
### CTO-27 — Πόσο downtime θεωρούμε αποδεκτό;
**CEO Answer:** 
99.999999%
### CTO-28 — Ποια data θέλουμε να διατηρούμε και για πόσο;
**CEO Answer:** 
Ότι ορίζει ο νόμος σε κάθε state σχετικά με προσωπικά δεδομένα.
### CTO-29 — Πρέπει οι users να μπορούν να διαγράφουν πλήρως uploaded/generated assets;
**CEO Answer:** 
Ναι Πάντα τα δικά του uploaded/generated assets.
### CTO-30 — Υπάρχει preferred tech stack ή η ομάδα επιλέγει βάσει requirements;
**CEO Answer:** 
TEAM RECOMMENDATION
---

# 2. AI/ML Engineer — Generative Imaging

### AI-01 — Ποιο είναι το primary promise: “Create anything” ή “Create great printable designs”;
**CEO Answer:** 
Create great printable designs
### AI-02 — Χρειαζόμαστε photorealistic designs;
**CEO Answer:** 
Εφόσον το ζητήσει ο πελάτης.
### AI-03 — Χρειαζόμαστε illustrated designs;
**CEO Answer:** 
Εφόσον το ζητήσει ο πελάτης.
### AI-04 — Χρειαζόμαστε typography-heavy designs;
**CEO Answer:** 
Εφόσον το ζητήσει ο πελάτης.
### AI-05 — Χρειαζόμαστε logo-style designs;
**CEO Answer:** 
Εφόσον το ζητήσει ο πελάτης.
### AI-06 — Χρειαζόμαστε vintage graphics;
**CEO Answer:** 
Εφόσον το ζητήσει ο πελάτης.
### AI-07 — Χρειαζόμαστε patterns;
**CEO Answer:** 
Εφόσον το ζητήσει ο πελάτης.
### AI-08 — Χρειαζόμαστε anime/cartoon styles;
**CEO Answer:** 
Εφόσον το ζητήσει ο πελάτης.
### AI-09 — Πρέπει η platform να υποστηρίζει όλες τις παραπάνω κατηγορίες;
**CEO Answer:** 
TEAM RECOMMENDATION
### AI-10 — Θέλουμε style selector πριν το generation;
**CEO Answer:** 
Προεραιτικό. TEAM RECOMMENDATION
### AI-11 — Θέλουμε curated styles όπως Vintage / Minimal / Comic / Tattoo / Y2K / Distressed;
**CEO Answer:** 
Προεραιτικό. TEAM RECOMMENDATION
### AI-12 — Μπορεί ο user να γράφει ένα απλό prompt και εμείς να το μετατρέπουμε σε sophisticated generation prompt;
**CEO Answer:** 
Ναι
### AI-13 — Θέλουμε να εμφανίζουμε το enhanced prompt στον user;
**CEO Answer:** 
Όχι
### AI-14 — Πόσα results θέλουμε ανά generation: 1, 2 ή 4;
**CEO Answer:** 
1
### AI-15 — Το default mode πρέπει να δίνει προτεραιότητα σε speed ή maximum quality;
**CEO Answer:** 
Maximum quality. Βέβαια αν αυτό απαιτεί πάρα πολύ χρόνο, θα πρέπει να το σταθμίσουμε με το speed και να αποφασίσουμε αργότερα. Εδώ θέλω την βοήθεια του CTO, AI/ML Engineer.
### AI-16 — Θέλουμε ξεχωριστά Speed / Quality modes;
**CEO Answer:** 
Όχι.
### AI-17 — Πληρώνει ο user ανά generation;
**CEO Answer:** 
Ναι, εφόσον έχει σπαταλήσει τα free generation credits.
### AI-18 — Υπάρχουν free generations;
**CEO Answer:** 
Ναι. Θα δούμε τα οικονομικά στοιχεία με τον CFO και θα αποφασίσουμε πόσα free generations θα έχει (3-5).
### AI-19 — Το regeneration μετράει ως νέο paid generation;
**CEO Answer:** 
Ναι.
### AI-20 — Τι πρέπει να συμβαίνει όταν το model αποτυγχάνει ξεκάθαρα;
**CEO Answer:** 
Σε ακραίες περιπτώσεις και όταν το generation το έχει δει ο πελάτης και είναι εντελώς εκτός του prompt και εφόσον επικοινωνήσει μαζί μας, τότε θα του επιστρέψουμε τα credits. Πρέπει όμως πρώτα να φτιάξουμε μια δικλείδα ασφαλείας πριν την προβολή του generated content έτσι ώστε να κάνει validate ότι ταιριάζει με το prompt. Εδώ θα ασχοληθούν οι CTO + AI/ML Engineer.
### AI-21 — Θέλουμε automatic quality scoring πριν δει το result ο user;
**CEO Answer:** 
Περίπου αυτό που ανέφερα παραπάνω.
### AI-22 — Θέλουμε malformed/low-quality outputs να απορρίπτονται και να γίνονται automatically regenerated;
**CEO Answer:** 
Ναι. Αν και εδώ θα πρέπει από την αρχή να έχουμε ορίσει εμείς τι ακριβώς παράγεται, σε ποιο τύπο, τι διάσταση, τι ποιότητα κοκ.
### AI-23 — Πρέπει το text που ζητά ο user να αποδίδεται 100% ακριβώς, ακόμη κι αν χρειάζεται ξεχωριστό typography layer;
**CEO Answer:** 
100% ακριβώς όπως το αναφέρει ο user.
### AI-24 — Το text πρέπει να παράγεται μέσα από το image model ή να γίνεται deterministic rendering όπου είναι δυνατό;
**CEO Answer:** 
TEAM RECOMMENDATION
### AI-25 — Μπορεί ο user να επιλέγει συγκεκριμένο font;
**CEO Answer:** 
Ναι, αλλά αυτό στα selections πριν το generate.
### AI-26 — Μπορούν οι users να κάνουν upload reference images;
**CEO Answer:** 
Ναι. Και όχι μόνο reference images, αλλά και images που θέλουν αυτούσια να εκτυπώσουν ή images που θέλουν να τροποποιήσει ελαφρώς το ai model.
### AI-27 — Μπορούν να κάνουν upload multiple reference images;
**CEO Answer:** 
Ναι. Με όριο που θα θέσουν οι CTO, AI/ML Engineer & CFO.
### AI-28 — Υποστηρίζουμε pose/composition references;
**CEO Answer:** 
Ναι. Στα preselections.
### AI-29 — Υποστηρίζουμε style references;
**CEO Answer:** 
Ναι. Στα preselections.
### AI-30 — Υποστηρίζουμε logo references;
**CEO Answer:** 
Ναι. Στα preselections. Αρκεί να μην αφορούν IP και trademarks. Εδώ θα ασχοληθεί ο AI/ML Engineer μαζί με τον IP Counsel.
### AI-31 — Πρέπει οι users να μπορούν να recreate/extract artwork από φωτογραφία T-shirt;
**CEO Answer:** 
Όχι extract artwork από άλλο t-shirt γιατί μπορεί να παραβιάζουν πνευματικά δικαιώματα. Μπορούν όμως σαν reference.
### AI-32 — Θέλουμε background removal automatic by default;
**CEO Answer:** 
Το background removal θα γίνεται σε περιπτώσεις upload εικόνων και σίγουρα στο generated content όπως απαιτεί το printify.
### AI-33 — Θέλουμε optional background generation;
**CEO Answer:** 
Ναι
### AI-34 — Υποστηρίζουμε inpainting/masking;
**CEO Answer:** 
TEAM RECOMMENDATION
### AI-35 — Μπορούν οι users να επιλέγουν individual objects;
**CEO Answer:** 
Στο regenerate με prompting.
### AI-36 — Υποστηρίζουμε “change only this part” editing;
**CEO Answer:** 
Ναι, στο regenerate.
### AI-37 — Μπορούν οι users να lockάρουν στοιχεία ώστε να μην αλλάζουν από AI edits;
**CEO Answer:** 
Ναι, στο regenerate με prompting.
### AI-38 — Απαιτούμε style consistency μεταξύ iterations;
**CEO Answer:** 
TEAM RECOMMENDATION
### AI-39 — Χρειαζόμαστε reproducibility μέσω seeds ή αντίστοιχων controls;
**CEO Answer:** 
TEAM RECOMMENDATION
### AI-40 — Θέλουμε proprietary LoRAs/styles στο launch ή αργότερα;
**CEO Answer:** 
TEAM RECOMMENDATION
### AI-41 — Επιτρέπουμε celebrity/public-person likenesses;
**CEO Answer:** 
TEAM RECOMMENDATION. Εδώ θα μας πει συγκεκριμένα ο IP Counsel.
### AI-42 — Επιτρέπουμε fan art;
**CEO Answer:** 
Ναι.
### AI-43 — Επιτρέπουμε copyrighted characters;
**CEO Answer:** 
Κατηγορηματικά όχι.
### AI-44 — Επιτρέπουμε brand logos;
**CEO Answer:** 
Κατηγορηματικά όχι.
### AI-45 — Επιτρέπουμε political content;
**CEO Answer:** 
Ναι, αλλά θα χρειαστεί να βάλουμε ορισμένα όρια.
### AI-46 — Επιτρέπουμε adult content;
**CEO Answer:** 
Κατηγορηματικά όχι.
### AI-47 — Επιτρέπουμε weapons/violent content;
**CEO Answer:** 
Κατηγορηματικά όχι.
### AI-48 — Θέλουμε moderation πριν το generation, μετά το generation ή και τα δύο;
**CEO Answer:** 
Πριν το generation.
### AI-49 — Μπορούν prompts/generated images να διατηρούνται για model improvement;
**CEO Answer:** 
Ναι, πάντα με την ενημέρωση προς τον πελάτη. Να ασχοληθεί ο IP Counsel.
### AI-50 — Μπορούν οι users να κάνουν opt-out από training/analytics use;
**CEO Answer:** 
Εφόσον υπάρχει νομοθεσία που υποχρεώνει να υπάρχει opt-out, τότε ναι. Εδώ θα μας πει ο IP Counsel.
---

# 3. Senior Frontend Engineer — Canvas / WebGL

### FE-01 — Μετά το generation, τι ακριβώς μπορεί να επεξεργαστεί ο user;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-02 — Position;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-03 — Scale;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-04 — Rotation;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-05 — Crop;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-06 — Background;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-07 — Individual text;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-08 — Font;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-09 — Text color;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-10 — Image colors;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-11 — Layers;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-12 — Remove individual objects;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-13 — AI-assisted object selection;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-14 — Masks;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-15 — Brush/eraser;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-16 — Filters;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-17 — Distress effects;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-18 — Outline/stroke;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-19 — Curved text;
**CEO Answer:** 
TEAM RECOMMENDATION
### FE-20 — Front + back printing;
**CEO Answer:** 
NOT MVP
### FE-21 — Sleeve printing όπου υποστηρίζεται;
**CEO Answer:** 
NOT MVP
### FE-22 — Πρέπει ο editor να δείχνει τα actual printable boundaries;
**CEO Answer:** 
Ναι
### FE-23 — Πρέπει να εμφανίζεται safe area;
**CEO Answer:** 
Ναι
### FE-24 — Πρέπει να εμφανίζεται bleed όπου είναι relevant;
**CEO Answer:** 
Ναι
### FE-25 — Invalid placement: hard block ή warning;
**CEO Answer:** 
Hard block
### FE-26 — Χρειαζόμαστε snapping και center guides;
**CEO Answer:** 
Ναι
### FE-27 — Χρειαζόμαστε alignment tools;
**CEO Answer:** 
Ναι
### FE-28 — Χρειαζόμαστε desktop keyboard shortcuts;
**CEO Answer:** 
Ναι
### FE-29 — Χρειαζόμαστε gesture editing στο mobile;
**CEO Answer:** 
Ναι
### FE-30 — Εμφανίζουμε live DPI indicator;
**CEO Answer:** 
Ναι
### FE-31 — Εμφανίζουμε low-resolution warnings;
**CEO Answer:** 
Ναι
### FE-32 — Εμφανίζουμε print-quality score;
**CEO Answer:** 
Ναι
### FE-33 — Εμφανίζουμε product-color contrast warnings;
**CEO Answer:** 
Ναι
### FE-34 — Θέλουμε flat 2D mockups ή photorealistic garment mockups;
**CEO Answer:** 
Ναι
### FE-35 — Θέλουμε model/lifestyle mockups με άτομο που φοράει το garment;
**CEO Answer:** 
Όχι
### FE-36 — Θέλουμε 3D preview αργότερα;
**CEO Answer:** 
Όχι
### FE-37 — Μπορεί ο user να κάνει design once και μετά να αλλάζει product χωρίς να χάνει placement;
**CEO Answer:** 
Ναι
### FE-38 — Αν αλλάζει σε product με διαφορετικό print area, κάνουμε auto-fit ή ζητάμε confirmation;
**CEO Answer:** 
Confirmation
### FE-39 — Χρειαζόμαστε autosave;
**CEO Answer:** 
Ναι
### FE-40 — Χρειαζόμαστε version snapshots;
**CEO Answer:** 
Ναι
### FE-41 — Χρειαζόμαστε Before/After comparison;
**CEO Answer:** 
Όχι
### FE-42 — Μπορούν οι users να κατεβάζουν τα designs;
**CEO Answer:** 
Όχι
### FE-43 — Αν επιτρέπονται downloads, είναι free ή paid;
**CEO Answer:** 
Δεν επιτρέπονται.
### FE-44 — Χρειάζονται watermarks στα previews;
**CEO Answer:** 
Ναι.
### FE-45 — Θέλουμε ο editor να είναι embeddable σε Shopify/third-party stores αργότερα;
**CEO Answer:** 
TEAM RECOMMENDATION
---

# 4. Product Designer — UX/UI

### UX-01 — Ποιο είναι το primary customer persona;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-02 — Individual που θέλει ένα unique shirt;
**CEO Answer:** 
Ναι
### UX-03 — Gift buyer;
**CEO Answer:** 
Ναι
### UX-04 — Families/events;
**CEO Answer:** 
Ναι
### UX-05 — Small businesses;
**CEO Answer:** 
Ναι
### UX-06 — Creators;
**CEO Answer:** 
Ναι
### UX-07 — Teams;
**CEO Answer:** 
Ναι
### UX-08 — Merch sellers;
**CEO Answer:** 
Ναι
### UX-09 — Ποιο use case πρέπει να εκτελεί εξαιρετικά καλά το MVP;
**CEO Answer:** 
Individual, Gift buyer
### UX-10 — Ξεκινά ο user από prompt ή από product;
**CEO Answer:** 
Product. Πιστεύω ότι επιλέγοντας το product ορίζει και το κατάλληλο prompt.
### UX-11 — Ποιο πρέπει να είναι το primary CTA;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-12 — “Create a Design”;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-13 — “Make Your Shirt”;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-14 — “Describe Your Idea”;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-15 — Θέλουμε inspiration/example prompts;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-16 — Θέλουμε template-based starting points;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-17 — Θέλουμε trending designs;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-18 — Θέλουμε “Surprise me” function;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-19 — Πρέπει το product color να επιλέγεται πριν το generation ώστε το artwork να προσαρμόζεται;
**CEO Answer:** 
Ναι. Καλό είναι.
### UX-20 — Ή δημιουργείται πρώτα το artwork και το product επιλέγεται μετά;
**CEO Answer:** 
Προτιμότερη η επιλογή του χρώματος πρώτα.
### UX-21 — Πόση editor complexity πρέπει να βλέπει ένας novice user;
**CEO Answer:** 
Απλό
### UX-22 — Θέλουμε Simple / Advanced modes;
**CEO Answer:** 
Ναι
### UX-23 — Θέλουμε AI chat δίπλα στο canvas;
**CEO Answer:** 
Όχι
### UX-24 — Θέλουμε floating prompt bar πάνω/δίπλα στο canvas;
**CEO Answer:** 
Όχι
### UX-25 — Θέλουμε edit menu παρόμοιο με Canva;
**CEO Answer:** 
Όχι
### UX-26 — Πρέπει το AI να προτείνει proactively modifications;
**CEO Answer:** 
Όχι
### UX-27 — Θέλουμε suggestions τύπου “Looks better on black”;
**CEO Answer:** 
Ναι
### UX-28 — Θέλουμε suggestions τύπου “Try this on a hoodie” ή αντίστοιχα cross-product ideas;
**CEO Answer:** 
Ναι
### UX-29 — Θέλουμε upsells;
**CEO Answer:** 
Ναι
### UX-30 — Θέλουμε front/back additions ως upsell;
**CEO Answer:** 
NOT MVP
### UX-31 — Θέλουμε quantity discounts;
**CEO Answer:** 
Ναι
### UX-32 — Πότε πρέπει να εμφανίζεται η τιμή;
**CEO Answer:** 
Από την στιγμή της επιλογής του προϊόντος με "από....".
### UX-33 — Από την αρχή;
**CEO Answer:** 
Από την στιγμή της επιλογής του προϊόντος με "από....".
### UX-34 — Μετά το generation;
**CEO Answer:** 
Από την στιγμή της επιλογής του προϊόντος με "από....".
### UX-35 — Δείχνουμε μόνο product price ή και generation cost;
**CEO Answer:** 
μόνο product price
### UX-36 — Πρέπει το shipping estimate να εμφανίζεται πριν το cart;
**CEO Answer:** 
στο checkout
### UX-37 — Πόσα steps είναι αποδεκτά από entry έως checkout;
**CEO Answer:** 
5
### UX-38 — Θέλουμε progress state/stepper;
**CEO Answer:** 
ναι
### UX-39 — Τι πρέπει να συμβαίνει όταν το πρώτο generation είναι κακό;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-40 — Πώς αποφεύγουμε το blank-canvas problem;
**CEO Answer:** 
TEAM RECOMMENDATION
### UX-41 — Θέλουμε satisfaction guarantee;
**CEO Answer:** 
Ναι
### UX-42 — Θέλουμε proof-approval checkbox πριν το payment;
**CEO Answer:** 
Ναι
### UX-43 — Πόσο ξεκάθαρα ενημερώνουμε ότι το physical print μπορεί να διαφέρει ελαφρώς από το digital mockup;
**CEO Answer:** 
Αρκετά
### UX-44 — Μπορεί ο user να αγοράσει το ίδιο design σε multiple products μέσα στο ίδιο cart;
**CEO Answer:** 
Ναι
### UX-45 — Είναι το “Design once, wear anywhere” core positioning idea;
**CEO Answer:** 
Ναι
---

# 5. Print Production / Prepress Specialist

### PP-01 — Είναι το MVP αποκλειστικά DTG T-shirts;
**CEO Answer:** 
Ναι
### PP-02 — Υποστηρίζουμε DTF;
**CEO Answer:** 
NOT MVP
### PP-03 — Υποστηρίζουμε hoodies;
**CEO Answer:** 
NOT MVP
### PP-04 — Υποστηρίζουμε embroidery;
**CEO Answer:** 
NOT MVP
### PP-05 — Υποστηρίζουμε mugs;
**CEO Answer:** 
NOT MVP
### PP-06 — Υποστηρίζουμε posters;
**CEO Answer:** 
NOT MVP
### PP-07 — Υποστηρίζουμε all-over print (AOP);
**CEO Answer:** 
NOT MVP
### PP-08 — Πότε θέλουμε να επεκταθούμε πέρα από το MVP product set;
**CEO Answer:** 
CEO, CFO και CTO θα αποφασίσουν μετά το launch κατά το πρώτο 3μηνο
### PP-09 — Δεχόμαστε user-uploaded artwork;
**CEO Answer:** 
Ναι
### PP-10 — Πρέπει το uploaded artwork να περνά από το ίδιο validation pipeline με το AI-generated artwork;
**CEO Answer:** 
Ναι
### PP-11 — Θέλουμε το default production master να είναι PNG;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-12 — Θέλουμε SVG όπου είναι δυνατό;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-13 — Θέλουμε transparent background by default;
**CEO Answer:** 
Ναι
### PP-14 — Θέλουμε να δημιουργείται πάντα 300 DPI production master όπου απαιτείται;
**CEO Answer:** 
Ναι
### PP-15 — Θέλουμε το AI να παράγει εξαρχής σε large production-oriented canvas ή επιτρέπουμε AI upscaling;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-16 — Πόσο aggressive επιτρέπεται να είναι το upscaling;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-17 — Θέλουμε automatic background cleanup;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-18 — Θέλουμε automatic edge cleanup;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-19 — Θέλουμε alpha-channel inspection;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-20 — Θέλουμε detection για problematic semi-transparency;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-21 — Θέλουμε automatic halftoning όπου απαιτείται;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-22 — Θέλουμε CMYK-style print simulation preview;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-23 — Θέλουμε warning ότι το print color μπορεί να διαφέρει από το monitor color;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-24 — Πρέπει το production file να αποθηκεύεται ξεχωριστά από το editable master;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-25 — Θέλουμε provider-specific production derivatives;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-26 — Τι συμβαίνει αν το fulfillment routing αλλάξει provider και επομένως αλλάξει το print area;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-27 — Auto-rescale;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-28 — Reject/reroute;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-29 — Human preflight;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-30 — Θέλουμε sample/test-print process πριν εγκρίνουμε κάθε νέο product/provider;
**CEO Answer:** 
Ναι per product. Αν ο provider έχει το ίδιο product (t-shirt), τότε όχι.
### PP-31 — Θέλουμε internal provider quality score;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-32 — Πρέπει η platform να περιορίζει products όταν ένα design δεν είναι compatible με συγκεκριμένο printing method;
**CEO Answer:** 
Ναι
### PP-33 — Παράδειγμα: detailed photographic artwork για embroidery — block ή simplification;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-34 — Θέλουμε automatic printability score από 0–100;
**CEO Answer:** 
TEAM RECOMMENDATION
### PP-35 — Πρέπει το checkout να μπλοκάρει κάτω από minimum printability score;
**CEO Answer:** 
TEAM RECOMMENDATION
---

# 6. Fractional CFO — Business Model & Unit Economics

### CFO-01 — Το primary revenue θα προέρχεται από product margin ή AI credits;
**CEO Answer:** 
Product margin
### CFO-02 — Μπορεί το generation να λειτουργεί ως loss-leader;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-03 — Θέλουμε subscriptions;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-04 — Θέλουμε credits;
**CEO Answer:** 
Ναι
### CFO-05 — Θέλουμε free generations per day;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-06 — Θέλουμε οι users να πληρώνουν μόνο όταν αγοράζουν physical product;
**CEO Answer:** 
Όχι. Και όταν θέλουν να αγοράσουν credits για generation, χωρίς αγορά φυσικού προϊόντος.
### CFO-07 — Θέλουμε hybrid monetization model;
**CEO Answer:** 
Ναι
### CFO-08 — Ποιο gross margin θέλουμε στα physical products;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-09 — Ποιο contribution margin θέλουμε;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-10 — Ποιο είναι το target AOV;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-11 — Ποιο είναι το target CAC;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-12 — Ποιο είναι το maximum acceptable AI cost per user session;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-13 — Ποιο είναι το maximum acceptable AI cost per order;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-14 — Πόσα generations περιμένουμε ότι θα χρειάζεται κατά μέσο όρο ένας converted user;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-15 — Χρεώνουμε το upscaling;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-16 — Χρεώνουμε το background removal;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-17 — Χρεώνουμε extra για premium models;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-18 — Χρεώνουμε για design downloads;
**CEO Answer:** 
Δεν επιτρέπουμε design downloads.
### CFO-19 — Χρεώνουμε για higher-resolution exports;
**CEO Answer:** 
Δεν επιτρέπουμε design downloads/exports.
### CFO-20 — Θέλουμε quantity discounts;
**CEO Answer:** 
Ναι
### CFO-21 — Θέλουμε free-shipping threshold;
**CEO Answer:** 
Ναι
### CFO-22 — Απορροφούμε το shipping ή το χρεώνεται ο customer;
**CEO Answer:** 
Το χρεώνεται ο πελάτης. Μετά το threshold το απορροφούμε. TEAM RECOMMENDATION
### CFO-23 — Κρατάμε ίδιο retail price ανεξάρτητα από routed provider;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-24 — Πόσο provider cost variance είμαστε διατεθειμένοι να δεχτούμε;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-25 — Θα τιμολογούμε κυρίως σε USD;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-26 — Ποιο legal/business entity θα εισπράττει τις πληρωμές;
**CEO Answer:** 
Ελληνικό business entity
### CFO-27 — Ποιες αγορές θα είναι διαθέσιμες στο Day 1;
**CEO Answer:** 
USA
### CFO-28 — Πώς θέλουμε να διαχειριζόμαστε taxes / US sales tax / VAT;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-29 — Ποια είναι η refund policy;
**CEO Answer:** 
Νομικά δεν γνωρίζω τι ισχύει στο US σχετικά με την υπαναχώρηση του πελάτη σε online αγορά, αλλά εφόσον τα προϊόντα είναι custom made νομίζω ότι δεν ισχύει return άρα όχι και refund. Εκτός από περιπτώσεις λάθους και ελαττωματικών.
### CFO-30 — Ποια είναι η reprint policy;
**CEO Answer:** 
Σε περιπτώσεις λάθους και ελαττωματικών
### CFO-31 — Ποιος απορροφά το κόστος αν ο customer δεν είναι ικανοποιημένος από AI-generated design μετά την παραγωγή;
**CEO Answer:** 
Κατά περίπτωση.
### CFO-32 — Πώς θέλουμε να χειριζόμαστε chargebacks;
**CEO Answer:** 
Προσκομίζουμε όλα τα δυνατά evidences στο open case.
### CFO-33 — Πώς θέλουμε να χειριζόμαστε fraud;
**CEO Answer:** 
Προσκομίζουμε όλα τα δυνατά evidences στο open case.
### CFO-34 — Ποιο είναι το MVP budget;
**CEO Answer:** 
15k dollars
### CFO-35 — Τι runway έχουμε ή θέλουμε;
**CEO Answer:** 
TEAM RECOMMENDATION
### CFO-36 — Ποιο είναι το target launch date;
**CEO Answer:** 
Q4 2026
### CFO-37 — Fundraising πριν ή μετά το MVP;
**CEO Answer:** 
Μετά το MVP
### CFO-38 — Ποια MVP metrics θα δικαιολογούσαν pre-seed/seed raise;
**CEO Answer:** 
Retention Rate, MoM Growth, Engagement, LTV : CAC Ratio  
---

# 7. Fractional IP Counsel — IP, Content, Privacy & Platform Risk

### IP-01 — Σε ποιες χώρες θα δραστηριοποιείται η εταιρεία;
**CEO Answer:** 
Το market είναι USA.
### IP-02 — Πού θα βρίσκεται το legal entity;
**CEO Answer:** 
Ελλάδα
### IP-03 — Επιτρέπουμε prompts με copyrighted characters;
**CEO Answer:** 
Όχι
### IP-04 — Disney;
**CEO Answer:** 
Όχι
### IP-05 — Marvel;
**CEO Answer:** 
Όχι
### IP-06 — Pokémon;
**CEO Answer:** 
Όχι
### IP-07 — NFL / NBA ή αντίστοιχο sports IP;
**CEO Answer:** 
Όχι
### IP-08 — Brand logos;
**CEO Answer:** 
Όχι
### IP-09 — Band logos;
**CEO Answer:** 
Όχι
### IP-10 — Song lyrics;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-11 — Celebrity likenesses;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-12 — Politicians/public figures;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-13 — User-uploaded photos τρίτων;
**CEO Answer:** 
Όχι
### IP-14 — Πώς πρέπει ο user να αποδεικνύει ότι έχει δικαίωμα χρήσης ενός logo;
**CEO Answer:** 
Με logo recognition και trademark detection
### IP-15 — Θέλουμε trademark detection;
**CEO Answer:** 
Ναι
### IP-16 — Θέλουμε logo recognition;
**CEO Answer:** 
Ναι
### IP-17 — Θέλουμε copyrighted-character detection;
**CEO Answer:** 
Ναι
### IP-18 — Θέλουμε moderation πριν το production;
**CEO Answer:** 
Στην αρχή ναι. Μετά θα μπει σε αυτοματισμό.
### IP-19 — Τα flagged orders περνούν από human review;
**CEO Answer:** 
Ναι
### IP-20 — Χρειαζόμαστε DMCA process;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-21 — Χρειαζόμαστε takedown process;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-22 — Χρειαζόμαστε repeat-infringer policy;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-23 — Ποιος “owns” συμβατικά τα AI-generated designs;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-24 — Τι license λαμβάνει η εταιρεία πάνω στο user content/designs;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-25 — Μπορούν τα generated customer designs να χρησιμοποιούνται στο marketing της εταιρείας;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-26 — Μόνο με explicit opt-in;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-27 — Μπορούν τα designs να εμφανίζονται σε public gallery;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-28 — Μπορούν άλλοι users να κάνουν remix public designs;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-29 — Μπορούν customer designs να χρησιμοποιούνται για fine-tuning;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-30 — Απαιτείται explicit consent για training/fine-tuning;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-31 — Πώς πρέπει να διαχειριζόμαστε personal data μέσα σε uploaded images;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-32 — Χρειαζόμαστε ειδικό handling για facial/biometric data;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-33 — Χρειαζόμαστε ειδικούς κανόνες για images παιδιών;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-34 — Ποια είναι η data-retention policy;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-35 — Υποστηρίζουμε GDPR deletion/export requirements από Day 1;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-36 — Πρέπει οι όροι κάθε AI provider να επιτρέπουν ρητά commercial merchandise use;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-37 — Θέλουμε indemnification clause από τους users;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-38 — Ποιο lawful content δεν θέλουμε να τυπώνουμε ανεξάρτητα από τη νομιμότητά του;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-39 — Πρέπει τα Terms να ξεχωρίζουν uploaded artwork από AI-generated artwork;
**CEO Answer:** 
TEAM RECOMMENDATION
### IP-40 — Πρέπει το final order να περνά δεύτερο compliance check ακριβώς πριν το Printify submission;
**CEO Answer:** 
TEAM RECOMMENDATION
---

# 8. CEO Strategic Decisions — Optional Summary

Συμπλήρωσε αυτό το section αφού ολοκληρώσεις τα specialist questionnaires, εφόσον το θεωρείς χρήσιμο.

## 8.1 One-Sentence Product Vision
**CEO Answer:** 
AI-powered custom apparel.
## 8.2 Primary Customer
**CEO Answer:** 
Independent merchandise creators
## 8.3 MVP Definition
**CEO Answer:** 
Text-to-design, basic checkout
## 8.4 Launch Market
**CEO Answer:** 
USA
## 8.5 Core Product Promise
**CEO Answer:** 
Instant premium merch
## 8.6 Primary Differentiation vs GPTShirt.ai
**CEO Answer:** 
Advanced design editor & High-resolution asset export
## 8.7 Business Model
**CEO Answer:** 
Print-on-demand margins
## 8.8 Fulfillment Strategy
**CEO Answer:** 
Third-party DTG dropshipping
## 8.9 AI Strategy
**CEO Answer:** 
Fine-tuned Stable Diffusion
## 8.10 Editing Strategy
**CEO Answer:** 
Advanced vector editing
## 8.11 Print Quality Strategy
**CEO Answer:** 
Premium blank validation
## 8.12 IP / Moderation Philosophy
**CEO Answer:** 
Automated keyword blocking
## 8.13 Τι είναι ρητά NOT MVP
**CEO Answer:** 
Bulk wholesale orders
## 8.14 Target Launch Date
**CEO Answer:** 
Q4 2026
## 8.15 MVP Success Criteria
**CEO Answer:** 
Retention above thirty
---

# 9. Open Questions / CEO Notes

Χρησιμοποίησε αυτό το section για οτιδήποτε δεν καλύπτεται παραπάνω.

## Notes
- Πολλά νομικά ερωτήματα είναι υπό την πλήρη καθοδήγηση του IP Counsel. Ίσως χρειαστεί να εντάξουμε στην ομάδα και νομικό σύμβουλο.
- Πολλά οικονομικά ερωτήματα στα οποία θα χρειαστώ αποκλειστικό meeting με τον CFO.
- 

---

# 10. Requirements Review Status

> Θα συμπληρωθεί κατά το Meeting #002.

## Specialist Review
- [ ] CTO reviewed
- [ ] AI/ML Engineer reviewed
- [ ] Senior Frontend Engineer reviewed
- [ ] Product Designer reviewed
- [ ] Print Production / Prepress Specialist reviewed
- [ ] Fractional CFO reviewed
- [ ] Fractional IP Counsel reviewed

## Decision Status
- [ ] Conflicts identified
- [ ] Team recommendations resolved
- [ ] TBD items categorized
- [ ] MVP scope locked
- [ ] V1 scope drafted
- [ ] Later roadmap drafted
- [ ] Architecture assumptions approved
- [ ] Ready for Master Build Prompt

---

# 11. Next Deliverable

Μετά την ολοκλήρωση του CEO questionnaire και το review από την specialist team, αυτό το document θα χρησιμοποιηθεί ως source of truth για το:

**`MASTER_BUILD_PROMPT.md`**

Expected sections:
- Product vision
- Personas and use cases
- MVP / V1 / Later scope
- Functional requirements
- Non-functional requirements
- UX flows
- Design editor specification
- AI model orchestration
- Prompt pipelines
- Image editing architecture
- Prepress engine
- Printability scoring
- Printify catalog integration
- Fulfillment routing
- Product mockups
- Commerce / checkout
- Order lifecycle
- Database schema
- API contracts
- Authentication
- Storage
- Moderation
- IP/compliance
- Admin platform
- Analytics
- Observability
- Security
- Testing
- CI/CD
- Infrastructure
- Repository structure
- Implementation milestones
- Acceptance criteria
- Codex execution rules
