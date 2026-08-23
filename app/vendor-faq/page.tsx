export const metadata = {
  title: "JRide Vendor FAQ",
  description: "Frequently asked questions for JRide Takeout vendors.",
};

type FaqItem = {
  question: string;
  answer: string;
};

const HOURS_FAQ: FaqItem[] = [
  {
    question: "Why does JRide require my opening and closing time?",
    answer:
      "JRide uses your normal business hours to prevent customers from placing new orders after your store has closed. This reduces missed orders, vendor timeouts, and customer cancellations.",
  },
  {
    question: "Do I need to enter my hours every day?",
    answer:
      "No. Set your normal daily opening and closing time once. You can edit the times later from the Store hours control in the vendor portal.",
  },
  {
    question: "What time zone does JRide use for vendor hours?",
    answer: "Vendor operating hours use Philippine time (Asia/Manila).",
  },
  {
    question: "Does the store automatically become open at my opening time?",
    answer:
      "Your schedule and the OPEN/CLOSED switch work together. If the vendor switch is OPEN, customers can order only during your normal hours or an active extension. If you set the switch to CLOSED, customers cannot place new orders even when your normal schedule says you are open.",
  },
  {
    question: "What happens at my normal closing time?",
    answer:
      "JRide automatically stops new customer orders when the normal closing time is reached. Orders that were already created before closing are not cancelled by the closing schedule and must still be handled normally.",
  },
  {
    question: "What if I want to stay open longer today?",
    answer:
      "Use Extend 30 min or Extend 60 min in Store hours. The extension is for the current business day only. JRide will continue accepting new orders during the extension as long as your vendor switch remains OPEN.",
  },
  {
    question: "Will JRide remind me before closing?",
    answer:
      "Yes. When the vendor portal is open, JRide shows a closing reminder during the last 15 minutes before the normal closing time. You can extend the day or choose to close on schedule. If you do nothing, new orders stop at closing time.",
  },
  {
    question: "What if I need to close early?",
    answer:
      "Set the vendor availability switch to CLOSED. This immediately blocks new customer orders. Your normal opening and closing times do not override a manual CLOSED setting.",
  },
  {
    question: "What if I open later than usual?",
    answer:
      "Keep the vendor availability switch CLOSED until you are ready, then set it to OPEN. The normal schedule never forces a manually closed vendor to accept orders.",
  },
  {
    question: "Can my normal hours pass midnight?",
    answer:
      "Yes. For example, an opening time of 6:00 PM and a closing time of 2:00 AM is treated as an overnight business schedule.",
  },
  {
    question: "What if my hours are different on some days?",
    answer:
      "The current vendor setup uses one normal daily schedule. Edit the normal hours when needed, or use the CLOSED switch on days or periods when you are not accepting orders.",
  },
  {
    question: "Does automatic closing still work if I close the vendor portal?",
    answer:
      "Yes. Customer ordering is checked on the server, so the normal closing rule does not depend on the vendor portal staying open. Keep the portal open during service hours if you want to see and hear live order alerts.",
  },
];

const ORDER_FAQ: FaqItem[] = [
  {
    question: "How quickly should I respond to a new Takeout order?",
    answer:
      "Respond before the acceptance countdown shown in the vendor portal expires. Keep the portal open during service hours so you can see the pending order and its countdown.",
  },
  {
    question: "Should I accept an order if an item is unavailable?",
    answer:
      "No. Accept only when you can prepare the requested order. If you cannot fulfill it, use the cancellation or rejection action and choose the correct reason, such as item sold out, store too busy, store closing soon, or cannot prepare on time.",
  },
  {
    question: "What happens if I do not respond within the acceptance time?",
    answer:
      "The pending vendor acceptance expires. The customer should not be left waiting for an order that the vendor did not confirm.",
  },
  {
    question: "What should I do after accepting an order?",
    answer:
      "Prepare the confirmed items and monitor the live order queue. JRide handles the driver assignment and delivery workflow. Use the order status controls in the vendor portal as the order progresses.",
  },
  {
    question: "What if the customer asks for a receipt?",
    answer:
      "Check the order details. If the order shows that a vendor receipt was requested, include the receipt with the order.",
  },
  {
    question: "Can I cancel an order after accepting it?",
    answer:
      "Use cancellation only when the order can no longer be fulfilled and select the most accurate reason. Avoid accepting orders that you already know you cannot prepare.",
  },
];

const MENU_FAQ: FaqItem[] = [
  {
    question: "How do I update my menu?",
    answer:
      "Use the menu section in the vendor portal to add or edit item names, descriptions, categories, prices, photos, preparation times, variants, and add-ons supported by the portal.",
  },
  {
    question: "What should I do when an item is sold out?",
    answer:
      "Mark the item unavailable or sold out in the vendor portal so customers do not place an order for an item you cannot prepare.",
  },
  {
    question: "Is store availability the same as item availability?",
    answer:
      "No. Store availability controls whether the vendor can receive new orders. Menu availability controls whether a specific item can be ordered. Both should be kept accurate.",
  },
];

const ALERT_FAQ: FaqItem[] = [
  {
    question: "How do I make sure I hear new order alerts?",
    answer:
      "Keep the vendor portal open during service hours, enable vendor sound, allow browser notifications when requested, and use the Test sound button to confirm that audio is working on the device.",
  },
  {
    question: "What if my internet connection is unstable?",
    answer:
      "A weak connection can delay the live vendor portal and order alerts. Use a stable internet connection during service hours and check the live order queue regularly.",
  },
  {
    question: "What if the portal shows something that does not match the actual order?",
    answer:
      "Do not guess or change the order outside the confirmed details. Refresh the vendor portal first. If the problem remains, contact JRide support or the JRide administrator and provide the order or booking code.",
  },
];

function FaqSection({ title, items }: { title: string; items: FaqItem[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <details key={item.question} className="group rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer list-none pr-6 text-sm font-bold text-slate-900">
              {item.question}
            </summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function VendorFaqPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">JRide Takeout</div>
          <h1 className="mt-2 text-3xl font-black">Vendor FAQ</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Quick operating guide for store hours, order acceptance, menu availability, and vendor alerts.
          </p>
          <a href="/vendor-portal" className="mt-5 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950">
            Back to Vendor Portal
          </a>
        </div>

        <div className="mt-5 space-y-5">
          <FaqSection title="Store hours and availability" items={HOURS_FAQ} />
          <FaqSection title="Receiving and handling orders" items={ORDER_FAQ} />
          <FaqSection title="Menu and sold-out items" items={MENU_FAQ} />
          <FaqSection title="Alerts and troubleshooting" items={ALERT_FAQ} />
        </div>
      </div>
    </main>
  );
}
