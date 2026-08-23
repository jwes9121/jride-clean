"use client";

import { useState } from "react";

type Language = "en" | "tl" | "ilo";
type LocalText = Record<Language, string>;
type FaqItem = {
  question: LocalText;
  answer: LocalText;
};

type FaqSection = {
  title: LocalText;
  items: FaqItem[];
};

const LANGUAGE_LABELS: Array<{ key: Language; label: string }> = [
  { key: "en", label: "English" },
  { key: "tl", label: "Tagalog" },
  { key: "ilo", label: "Ilocano" },
];

const PAGE_TEXT = {
  eyebrow: {
    en: "JRide Takeout",
    tl: "JRide Takeout",
    ilo: "JRide Takeout",
  },
  title: {
    en: "Vendor FAQ",
    tl: "Mga Madalas Itanong ng Vendor",
    ilo: "Dagiti Masansan a Saludsod ti Vendor",
  },
  intro: {
    en: "Quick guide for store hours, accepting orders, preparation, menu availability, and vendor alerts.",
    tl: "Mabilis na gabay para sa oras ng tindahan, pag-accept ng order, paghahanda, menu availability, at vendor alerts.",
    ilo: "Napartak a giya para iti oras ti tindaan, panag-accept ti order, panagisagana, menu availability, ken vendor alerts.",
  },
  back: {
    en: "Back to Vendor Portal",
    tl: "Bumalik sa Vendor Portal",
    ilo: "Agsubli iti Vendor Portal",
  },
} satisfies Record<string, LocalText>;

const SECTIONS: FaqSection[] = [
  {
    title: {
      en: "Store hours and daily availability",
      tl: "Oras ng tindahan at araw-araw na availability",
      ilo: "Oras ti tindaan ken inaldaw nga availability",
    },
    items: [
      {
        question: {
          en: "Why do I need to set my normal opening and closing time?",
          tl: "Bakit kailangan kong ilagay ang normal opening at closing time?",
          ilo: "Apay a masapul nga ikabil ko ti normal opening ken closing time?",
        },
        answer: {
          en: "JRide uses these times as your normal ordering window. New customer orders are blocked after your closing time. Set the hours that your store normally follows and observe any local curfew or closing rules in your area.",
          tl: "Ginagamit ng JRide ang oras na ito bilang normal ordering window ng tindahan. Hindi na makakapaglagay ng bagong order ang customer pagkatapos ng closing time. Ilagay ang oras na normal ninyong sinusunod at sundin ang curfew o local closing rules sa inyong lugar.",
          ilo: "Usaren ti JRide dagitoy nga oras kas normal ordering window ti tindaan. Saanen a maka-order ti customer kalpasan ti closing time. Ikabil ti oras a gagangay a suroten ti tindaan ken suroten dagiti curfew wenno local closing rules iti lugaryo.",
        },
      },
      {
        question: {
          en: "Does JRide automatically open my store every day?",
          tl: "Awtomatikong binubuksan ba ng JRide ang store ko araw-araw?",
          ilo: "Automatiko kadi nga lukatan ti JRide ti tindaan ko iti tunggal aldaw?",
        },
        answer: {
          en: "No. Your store stays OFFLINE until you open the Vendor Portal and choose OPEN FOR ORDERS TODAY. You must do this each day when you are ready to receive orders. Your saved business hours do not automatically turn the store on.",
          tl: "Hindi. Mananatiling OFFLINE ang store hanggang buksan ninyo ang Vendor Portal at piliin ang OPEN FOR ORDERS TODAY. Gawin ito bawat araw kapag handa na kayong tumanggap ng orders. Hindi awtomatikong ino-on ng saved business hours ang store.",
          ilo: "Saan. Agtalinaed nga OFFLINE ti tindaan agingga a lukatan yo ti Vendor Portal ken pilien ti OPEN FOR ORDERS TODAY. Aramiden daytoy iti tunggal aldaw no nakasaganakayo nga umawat ti orders. Saan nga automatiko nga i-on ti saved business hours ti tindaan.",
        },
      },
      {
        question: {
          en: "Do I need to enter my business hours every day?",
          tl: "Kailangan ko bang ilagay ulit ang business hours araw-araw?",
          ilo: "Masapul kadi nga ikabil ko manen ti business hours iti tunggal aldaw?",
        },
        answer: {
          en: "No. Save your normal opening and closing time once, then change it only when your regular schedule changes. What you must do every day is manually open the store for orders.",
          tl: "Hindi. I-save ang normal opening at closing time isang beses at baguhin lamang kapag nagbago ang regular schedule. Ang kailangang gawin araw-araw ay manual na i-open ang store para sa orders.",
          ilo: "Saan. I-save ti normal opening ken closing time maminsan, ket baliwan laeng no nagbaliw ti regular schedule. Ti masapul nga aramiden iti tunggal aldaw ket manual a lukatan ti tindaan para kadagiti orders.",
        },
      },
      {
        question: {
          en: "Can I set overnight business hours?",
          tl: "Puwede ba akong mag-set ng overnight business hours?",
          ilo: "Mabalin kadi nga ag-set iti overnight business hours?",
        },
        answer: {
          en: "No, not at this time. Closing time must be later than opening time on the same day. JRide Takeout is currently designed around the normal local store hours and curfew conditions in the service towns.",
          tl: "Hindi sa ngayon. Dapat mas late ang closing time kaysa opening time sa parehong araw. Ang JRide Takeout ay kasalukuyang nakaayos para sa normal na oras ng mga tindahan at curfew conditions sa mga service town.",
          ilo: "Saan pay ita. Masapul a naladladaw ti closing time ngem ti opening time iti isu met laeng nga aldaw. Ti JRide Takeout ket naurnos ita para iti normal nga oras dagiti tindaan ken curfew conditions kadagiti service town.",
        },
      },
      {
        question: {
          en: "What happens when my normal closing time is near?",
          tl: "Ano ang mangyayari kapag malapit na ang normal closing time?",
          ilo: "Ania ti mapasamak no asidegen ti normal closing time?",
        },
        answer: {
          en: "If the Vendor Portal is open, JRide shows a reminder about 15 minutes before your configured closing time. You can close on schedule or extend by 30 or 60 minutes if your store can still operate and local curfew rules allow it.",
          tl: "Kapag bukas ang Vendor Portal, magpapakita ang JRide ng reminder mga 15 minuto bago ang naka-set na closing time. Puwede kayong magsara ayon sa schedule o mag-extend ng 30 o 60 minuto kung kaya pang mag-operate ng store at pinapayagan ng local curfew rules.",
          ilo: "No nakalukat ti Vendor Portal, mangipakita ti JRide iti reminder agarup 15 minutos sakbay ti na-set a closing time. Mabalin nga agserra ayon iti schedule wenno ag-extend iti 30 wenno 60 minutos no mabalin pay nga ag-operate ti tindaan ken palubosan dagiti local curfew rules.",
        },
      },
      {
        question: {
          en: "What happens if I do nothing at closing time?",
          tl: "Ano ang mangyayari kung wala akong gawin sa closing time?",
          ilo: "Ania ti mapasamak no awan ti aramidek iti closing time?",
        },
        answer: {
          en: "JRide automatically blocks NEW customer orders at closing time. Orders already accepted or already in progress must still be completed normally.",
          tl: "Awtomatikong iba-block ng JRide ang BAGONG customer orders sa closing time. Ang mga order na na-accept na o kasalukuyang pinoproseso ay kailangan pa ring kumpletuhin nang normal.",
          ilo: "Automatiko nga iblock ti JRide dagiti BARO a customer orders iti closing time. Dagiti order a na-accepten wenno agtultuloyen ti proseso ket masapul latta a kompletoen a normal.",
        },
      },
      {
        question: {
          en: "What if I need to close early?",
          tl: "Paano kung kailangan kong magsara nang mas maaga?",
          ilo: "Kasano no masapul nga agserra kami iti nasapsapa?",
        },
        answer: {
          en: "Use the CLOSED control in the Vendor Portal. New orders stop immediately. Your saved normal hours do not force the store to remain open.",
          tl: "Gamitin ang CLOSED control sa Vendor Portal. Hihinto agad ang bagong orders. Hindi kayo pipilitin ng saved normal hours na manatiling open.",
          ilo: "Usaren ti CLOSED control iti Vendor Portal. Agsardeng a dagus dagiti baro nga orders. Saan nga piliten ti saved normal hours nga agtalinaed a nakalukat ti tindaan.",
        },
      },
    ],
  },
  {
    title: {
      en: "Receiving and handling Takeout orders",
      tl: "Pagtanggap at pag-handle ng Takeout orders",
      ilo: "Panagawat ken panang-asikaso kadagiti Takeout orders",
    },
    items: [
      {
        question: {
          en: "What should I check before accepting an order?",
          tl: "Ano ang dapat kong i-check bago i-accept ang order?",
          ilo: "Ania ti masapul a kitaek sakbay nga i-accept ti order?",
        },
        answer: {
          en: "Make sure every ordered item is available and that your store can fulfill the complete order. Do not press Accept if an item is missing, sold out, or cannot be provided. Reject the order while it is still pending instead.",
          tl: "Siguraduhing available ang lahat ng item at kayang kumpletuhin ng store ang buong order. Huwag pindutin ang Accept kung may kulang, sold out, o hindi maibibigay na item. I-reject ang order habang pending pa.",
          ilo: "Siguraduen nga adda amin dagiti na-order nga item ken kabaelan ti tindaan a kompletoen ti entero nga order. Saan a pinduten ti Accept no adda kurang, sold out, wenno saan a maited nga item. I-reject ti order bayat a pending pay.",
        },
      },
      {
        question: {
          en: "What should I do after accepting an order?",
          tl: "Ano ang gagawin ko pagkatapos i-accept ang order?",
          ilo: "Ania ti aramidek kalpasan nga i-accept ti order?",
        },
        answer: {
          en: "Do not cook, assemble, or finalize the order yet. Confirm that all accepted items are available and get the ingredients, stock, packaging, or other needed materials ready. Then wait for JRide to assign a driver. The driver proposes the delivery fee. Start preparing the actual order only after the passenger accepts the driver's Proposed Fare.",
          tl: "Huwag munang lutuin, buuin, o i-finalize ang order. Siguraduhin muna na available ang lahat ng na-accept na item at ihanda lamang ang ingredients, stock, packaging, at iba pang kailangan. Pagkatapos, hintayin munang ma-assign ang driver. Ang driver ang magpo-propose ng delivery fee. Saka lamang simulan ang aktuwal na paghahanda ng order kapag tinanggap ng passenger ang Proposed Fare ng driver.",
          ilo: "Saan pay nga lutoen, kompletoen, wenno i-finalize ti order. Siguraduen nga adda amin dagiti na-accept nga item ken isagana laeng dagiti ingredients, stock, packaging, ken dadduma a kasapulan. Kalpasanna, urayen nga ma-assign ti driver. Ti driver ti mang-propose iti delivery fee. Mangrugi laeng iti aktuwal a panangisagana ti order no inakseptar ti passenger ti Proposed Fare ti driver.",
        },
      },
      {
        question: {
          en: "Why should I wait for the passenger to accept the driver's Proposed Fare?",
          tl: "Bakit kailangan kong hintayin na i-accept ng passenger ang Proposed Fare ng driver?",
          ilo: "Apay a masapul nga urayek nga i-accept ti passenger ti Proposed Fare ti driver?",
        },
        answer: {
          en: "Vendor acceptance only confirms that the items are available. The Takeout order should be prepared for final fulfillment only after a driver is assigned, proposes the delivery fee, and the passenger accepts that Proposed Fare. This avoids preparing an order that may not proceed.",
          tl: "Ang vendor acceptance ay kumpirmasyon lamang na available ang mga item. Dapat lang ihanda para sa final fulfillment ang Takeout order kapag may assigned driver na, nakapag-propose na siya ng delivery fee, at tinanggap na ng passenger ang Proposed Fare. Nakakaiwas ito sa paghahanda ng order na maaaring hindi tumuloy.",
          ilo: "Ti vendor acceptance ket kumpirmasion laeng nga adda dagiti item. Masapul laeng nga isagana para iti final fulfillment ti Takeout order no adda assigned driver, nakapag-propose isuna iti delivery fee, ken inakseptar ti passenger ti Proposed Fare. Daytoy ket mangliklik iti panangisagana iti order a mabalin a saan nga agtuloy.",
        },
      },
      {
        question: {
          en: "Can I cancel an order after accepting it?",
          tl: "Puwede ko bang i-cancel ang order pagkatapos ko itong i-accept?",
          ilo: "Mabalin kadi nga i-cancel ti order kalpasan nga in-accept ko?",
        },
        answer: {
          en: "NO. Before pressing Accept, make sure every item is available and your store can complete the order. Once the vendor accepts the order, vendor cancellation is no longer allowed. If a real emergency makes fulfillment impossible, contact JRide admin immediately. An emergency cancellation must be handled as an admin exception, not as a normal vendor cancellation.",
          tl: "HINDI. Bago pindutin ang Accept, siguraduhing available ang lahat ng item at kayang kumpletuhin ng store ang order. Kapag na-accept na ng vendor ang order, hindi na puwedeng i-cancel ng vendor. Kung may tunay na emergency at imposibleng kumpletuhin ang order, kontakin agad ang JRide admin. Ang emergency cancellation ay admin exception at hindi normal vendor cancellation.",
          ilo: "SAAN. Sakbay a pinduten ti Accept, siguraduen nga adda amin dagiti item ken kabaelan ti tindaan a kompletoen ti order. No na-accepten ti vendor ti order, saanen a mabalin nga i-cancel ti vendor. No adda pudno nga emergency ket saanen a mabalin a kompletoen ti order, kontaken a dagus ti JRide admin. Ti emergency cancellation ket admin exception, saan a normal vendor cancellation.",
        },
      },
      {
        question: {
          en: "What if I cannot fulfill the order before I accept it?",
          tl: "Paano kung hindi ko kayang kumpletuhin ang order bago ko ito i-accept?",
          ilo: "Kasano no saan ko a kabaelan a kompletoen ti order sakbay nga i-accept?",
        },
        answer: {
          en: "Reject the order while it is still pending and choose the correct reason. This is the proper time to reject because no vendor commitment has been made yet.",
          tl: "I-reject ang order habang pending pa at piliin ang tamang dahilan. Ito ang tamang oras para mag-reject dahil wala pang vendor commitment.",
          ilo: "I-reject ti order bayat a pending pay ken pilien ti umno a rason. Daytoy ti umno a tiempo nga ag-reject gapu ta awan pay ti vendor commitment.",
        },
      },
      {
        question: {
          en: "What if the customer asks for a receipt?",
          tl: "Paano kung humingi ng resibo ang customer?",
          ilo: "Kasano no agkiddaw ti customer iti resibo?",
        },
        answer: {
          en: "Check the order details. If Vendor receipt requested is shown, include the store receipt with the order.",
          tl: "I-check ang order details. Kapag nakalagay ang Vendor receipt requested, isama ang resibo ng store sa order.",
          ilo: "Kitaen dagiti order details. No makita ti Vendor receipt requested, iraman ti resibo ti tindaan iti order.",
        },
      },
    ],
  },
  {
    title: {
      en: "Menu and item availability",
      tl: "Menu at item availability",
      ilo: "Menu ken item availability",
    },
    items: [
      {
        question: {
          en: "What should I do when an item is sold out?",
          tl: "Ano ang gagawin kapag sold out ang item?",
          ilo: "Ania ti aramiden no sold out ti item?",
        },
        answer: {
          en: "Mark the item unavailable or sold out in the Vendor Portal immediately so customers cannot order it.",
          tl: "I-mark agad ang item bilang unavailable o sold out sa Vendor Portal para hindi na ito ma-order ng customer.",
          ilo: "I-mark a dagus ti item kas unavailable wenno sold out iti Vendor Portal tapno saanen a ma-order ti customer.",
        },
      },
      {
        question: {
          en: "Is store availability the same as item availability?",
          tl: "Pareho ba ang store availability at item availability?",
          ilo: "Agpada kadi ti store availability ken item availability?",
        },
        answer: {
          en: "No. Store availability controls whether your store can receive new orders. Item availability controls whether a specific menu item can be ordered. Keep both accurate.",
          tl: "Hindi. Ang store availability ang nagkokontrol kung puwedeng tumanggap ng bagong order ang store. Ang item availability naman ang nagkokontrol kung puwedeng i-order ang isang partikular na item. Panatilihing tama ang pareho.",
          ilo: "Saan. Ti store availability ti mangkontrol no mabalin nga umawat ti tindaan iti baro nga order. Ti item availability ti mangkontrol no mabalin a ma-order ti maysa a menu item. Siguraduen nga husto dagitoy a dua.",
        },
      },
      {
        question: {
          en: "How do I update my menu?",
          tl: "Paano ko ia-update ang menu?",
          ilo: "Kasano nga i-update ti menu?",
        },
        answer: {
          en: "Use the menu section in the Vendor Portal to update item names, descriptions, prices, photos, preparation times, variants, add-ons, and availability.",
          tl: "Gamitin ang menu section sa Vendor Portal para i-update ang item name, description, price, photo, preparation time, variants, add-ons, at availability.",
          ilo: "Usaren ti menu section iti Vendor Portal tapno i-update ti item name, description, price, photo, preparation time, variants, add-ons, ken availability.",
        },
      },
    ],
  },
  {
    title: {
      en: "Alerts and troubleshooting",
      tl: "Alerts at troubleshooting",
      ilo: "Alerts ken troubleshooting",
    },
    items: [
      {
        question: {
          en: "How do I make sure I hear new order alerts?",
          tl: "Paano ko masisigurong maririnig ko ang bagong order alert?",
          ilo: "Kasano a masiguradok a mangngeg ko ti baro nga order alert?",
        },
        answer: {
          en: "Keep the Vendor Portal open during service hours, enable vendor sound, allow notifications when requested, and use Test sound to confirm that audio works on the device.",
          tl: "Panatilihing bukas ang Vendor Portal habang tumatanggap ng orders, i-enable ang vendor sound, payagan ang notifications kapag hiningi, at gamitin ang Test sound para masigurong gumagana ang audio sa device.",
          ilo: "Pagtalinaeden a nakalukat ti Vendor Portal bayat ti service hours, i-enable ti vendor sound, palubosan dagiti notifications no maidawat, ken usaren ti Test sound tapno masigurado a gumagana ti audio iti device.",
        },
      },
      {
        question: {
          en: "What if my internet connection is unstable?",
          tl: "Paano kung mahina o unstable ang internet?",
          ilo: "Kasano no nakapuy wenno unstable ti internet?",
        },
        answer: {
          en: "A weak connection can delay the live order queue and alerts. Use a stable connection during service hours and check the Vendor Portal regularly.",
          tl: "Maaaring ma-delay ang live order queue at alerts kapag mahina ang internet. Gumamit ng stable connection habang tumatanggap ng orders at regular na i-check ang Vendor Portal.",
          ilo: "Mabalin a ma-delay ti live order queue ken alerts no nakapuy ti internet. Agusarkayo iti stable connection bayat ti service hours ken regular a kitaen ti Vendor Portal.",
        },
      },
      {
        question: {
          en: "What if the portal information does not match the actual order?",
          tl: "Paano kung hindi tugma ang nasa portal sa aktuwal na order?",
          ilo: "Kasano no saan nga agtutunos ti adda iti portal ken ti aktuwal nga order?",
        },
        answer: {
          en: "Do not guess or change the order outside the confirmed details. Refresh the Vendor Portal first. If the problem remains, contact JRide support or the JRide administrator and provide the booking code.",
          tl: "Huwag manghula o baguhin ang order na wala sa confirmed details. I-refresh muna ang Vendor Portal. Kung nandoon pa rin ang problema, kontakin ang JRide support o administrator at ibigay ang booking code.",
          ilo: "Saan nga agpagarup wenno agbaliw iti order a saan nga adda kadagiti confirmed details. I-refresh pay ti Vendor Portal. No adda latta ti problema, kontaken ti JRide support wenno administrator ken ited ti booking code.",
        },
      },
    ],
  },
];

function Section({ section, language }: { section: FaqSection; language: Language }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">{section.title[language]}</h2>
      <div className="mt-4 space-y-3">
        {section.items.map((item) => (
          <details key={item.question.en} className="group rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer list-none pr-6 text-sm font-bold text-slate-900">
              {item.question[language]}
            </summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.answer[language]}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function VendorFaqPage() {
  const [language, setLanguage] = useState<Language>("en");

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">{PAGE_TEXT.eyebrow[language]}</div>
          <h1 className="mt-2 text-3xl font-black">{PAGE_TEXT.title[language]}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{PAGE_TEXT.intro[language]}</p>

          <div className="mt-5 flex flex-wrap gap-2" aria-label="FAQ language">
            {LANGUAGE_LABELS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setLanguage(option.key)}
                className={`rounded-xl border px-4 py-2 text-sm font-bold ${
                  language === option.key
                    ? "border-white bg-white text-slate-950"
                    : "border-slate-600 bg-slate-900 text-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <a href="/vendor-portal" className="mt-4 inline-flex rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
            {PAGE_TEXT.back[language]}
          </a>
        </div>

        <div className="mt-5 space-y-5">
          {SECTIONS.map((section) => (
            <Section key={section.title.en} section={section} language={language} />
          ))}
        </div>
      </div>
    </main>
  );
}
