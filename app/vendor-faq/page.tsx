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
  featured?: boolean;
};

const LANGUAGE_LABELS: Array<{ key: Language; label: string }> = [
  { key: "en", label: "English" },
  { key: "tl", label: "Tagalog" },
  { key: "ilo", label: "Ilocano" },
];

function t(en: string, tl: string, ilo: string): LocalText {
  return { en, tl, ilo };
}

const PAGE_TEXT = {
  eyebrow: t("JRide Takeout", "JRide Takeout", "JRide Takeout"),
  title: t(
    "Vendor FAQ",
    "Mga Madalas Itanong ng Vendor",
    "Dagiti Masansan a Saludsod ti Vendor"
  ),
  intro: t(
    "Current guide for daily store opening, Takeout order handling, automatic compliance rules, suspensions, disputes, menu availability, and alerts.",
    "Kasalukuyang gabay para sa araw-araw na pagbukas ng store, pag-handle ng Takeout orders, automatic compliance rules, suspension, dispute, menu availability, at alerts.",
    "Agdama a giya para iti inaldaw a pananglukat ti tindaan, panang-asikaso kadagiti Takeout orders, automatic compliance rules, suspension, dispute, menu availability, ken alerts."
  ),
  currentRules: t(
    "CURRENT AUTOMATIC COMPLIANCE RULES",
    "KASALUKUYANG AUTOMATIC COMPLIANCE RULES",
    "AGDAMA NGA AUTOMATIC COMPLIANCE RULES"
  ),
  currentRulesSummary: t(
    "Three accumulated unanswered or expired Takeout orders, or three consecutive operating days without manually opening the store and without an approved exception, automatically suspend new-order access for 7 days. Reaching the same offense threshold again automatically results in a 30-day suspension.",
    "Tatlong naipong unanswered o expired Takeout orders, o tatlong sunod-sunod na operating days na hindi minanual open ang store at walang approved exception, ay awtomatikong magsu-suspend ng new-order access sa loob ng 7 araw. Kapag naabot ulit ang parehong offense threshold, awtomatikong magiging 30 araw ang suspension.",
    "Tallo a naurnong nga saan a nasungbatan wenno nag-expire a Takeout orders, wenno tallo nga agsasaruno nga operating days a saan a manual a nalukatan ti tindaan ken awan approved exception, ket automatiko a mang-suspend iti new-order access iti 7 aldaw. No maabot manen ti isu met laeng nga offense threshold, automatiko a 30 aldaw ti suspension."
  ),
  back: t(
    "Back to Vendor Portal",
    "Bumalik sa Vendor Portal",
    "Agsubli iti Vendor Portal"
  ),
} satisfies Record<string, LocalText>;

const SECTIONS: FaqSection[] = [
  {
    featured: true,
    title: t(
      "Automatic compliance and suspensions",
      "Automatic compliance at suspension",
      "Automatic compliance ken suspension"
    ),
    items: [
      {
        question: t(
          "What actions automatically suspend my store?",
          "Anong mga action ang awtomatikong magsu-suspend sa store ko?",
          "Ania dagiti aramid a mangpa-automatic suspension iti tindaan ko?"
        ),
        answer: t(
          "JRide automatically suspends new-order access when the system records either: (1) three accumulated unanswered or expired Takeout orders, or (2) three consecutive operating days without a manual store opening and without an approved closure or valid system exception. The first suspension for that offense lasts 7 days.",
          "Awtomatikong sinu-suspend ng JRide ang new-order access kapag na-record ng system ang alinman sa: (1) tatlong naipong unanswered o expired Takeout orders, o (2) tatlong sunod-sunod na operating days na hindi minanual open ang store at walang approved closure o valid system exception. Ang unang suspension para sa offense na iyon ay 7 araw.",
          "Automatiko a i-suspend ti JRide ti new-order access no ma-record ti system ti uray maysa kadagitoy: (1) tallo a naurnong nga saan a nasungbatan wenno nag-expire a Takeout orders, wenno (2) tallo nga agsasaruno nga operating days a saan a manual a nalukatan ti tindaan ken awan approved closure wenno valid system exception. Ti umuna a suspension para iti dayta nga offense ket 7 aldaw."
        ),
      },
      {
        question: t(
          "What does three accumulated unanswered or expired orders mean?",
          "Ano ang ibig sabihin ng tatlong naipong unanswered o expired orders?",
          "Ania ti kayat a sawen ti tallo a naurnong nga saan a nasungbatan wenno nag-expire nga orders?"
        ),
        answer: t(
          "Every Takeout order that expires because the vendor did not accept or decline it within the response period is added to the current compliance count. The orders do not need to be consecutive. Accepting or declining a later order does not erase earlier unanswered orders. After a suspension is applied, the accumulated count used for that suspension is cleared and the next compliance cycle starts at zero.",
          "Bawat Takeout order na nag-expire dahil hindi ito na-accept o na-decline sa loob ng response period ay idinadagdag sa kasalukuyang compliance count. Hindi kailangang sunod-sunod ang orders. Ang pag-accept o pag-decline ng susunod na order ay hindi nagbubura sa naunang unanswered orders. Kapag na-apply na ang suspension, kino-clear ang accumulated count na ginamit sa suspension at magsisimula sa zero ang susunod na compliance cycle.",
          "Tunggal Takeout order a nag-expire gapu ta saan a na-accept wenno na-decline iti uneg ti response period ket mainayon iti agdama a compliance count. Saan a masapul nga agsasaruno dagiti orders. Ti panang-accept wenno panang-decline iti sumaruno nga order ket saan a mangikkat kadagiti immun-una a saan a nasungbatan nga orders. No na-apply ti suspension, ma-clear ti accumulated count a nausar iti suspension ket mangrugi iti zero ti sumaruno a compliance cycle."
        ),
      },
      {
        question: t(
          "How long do I have to answer a new Takeout order?",
          "Gaano katagal bago ko kailangang sagutin ang bagong Takeout order?",
          "Kasano kabayag sakbay a masapul a sungbatak ti baro a Takeout order?"
        ),
        answer: t(
          "Answer within 5 minutes by choosing Accept or Decline. A timely decline is a valid response and does not count as an unanswered order. If the order expires without either response, it is added to the accumulated unanswered-order count.",
          "Sumagot sa loob ng 5 minuto sa pamamagitan ng Accept o Decline. Ang pag-decline sa tamang oras ay valid response at hindi mabibilang na unanswered order. Kapag nag-expire ang order nang walang Accept o Decline, idaragdag ito sa naipong unanswered-order count.",
          "Sungbatan iti uneg ti 5 minutos babaen ti Accept wenno Decline. Ti nasapa a panang-decline ket valid response ken saan a maibilang kas unanswered order. No nag-expire ti order nga awan ti Accept wenno Decline, mainayon dayta iti naurnong nga unanswered-order count."
        ),
      },
      {
        question: t(
          "Why must I manually open the store every day?",
          "Bakit kailangan kong manual na buksan ang store araw-araw?",
          "Apay a masapul a manual a lukatak ti tindaan iti tunggal aldaw?"
        ),
        answer: t(
          "Opening the JRide app, browser, or Vendor Portal does not open the store. Select OPEN FOR ORDERS TODAY each operating day when you are ready. Until you do this, the store remains closed and receives no new orders. Three consecutive operating days without a manual opening and without an approved exception automatically trigger a 7-day suspension.",
          "Ang pagbukas ng JRide app, browser, o Vendor Portal ay hindi awtomatikong nagbubukas ng store. Piliin ang OPEN FOR ORDERS TODAY bawat operating day kapag handa na kayo. Hangga't hindi ito ginagawa, mananatiling closed ang store at walang bagong orders. Tatlong sunod-sunod na operating days na walang manual opening at walang approved exception ay awtomatikong magti-trigger ng 7-day suspension.",
          "Ti pananglukat iti JRide app, browser, wenno Vendor Portal ket saan nga automatiko a manglukat iti tindaan. Pilien ti OPEN FOR ORDERS TODAY iti tunggal operating day no nakasaganakayo. Agingga a saan yo nga aramiden daytoy, agtalinaed a closed ti tindaan ken awan ti baro nga orders. Tallo nga agsasaruno nga operating days nga awan manual opening ken awan approved exception ket automatiko a mang-trigger iti 7-day suspension."
        ),
      },
      {
        question: t(
          "What if my store will be closed or I have a valid reason?",
          "Paano kung sarado ang store ko o may valid akong dahilan?",
          "Kasano no nakaserra ti tindaan ko wenno adda valid a rason?"
        ),
        answer: t(
          "Contact JRide through the official support channel so an approved closure or valid exception can be recorded. Include the affected date, reason, and available proof. Simply closing the app or leaving the store offline is not an approved closure. An approved closure or valid system exception breaks the consecutive missed-opening count.",
          "Kontakin ang JRide sa official support channel para ma-record ang approved closure o valid exception. Isama ang apektadong date, dahilan, at available na proof. Ang simpleng pagsara ng app o pag-iwan sa store na offline ay hindi approved closure. Ang approved closure o valid system exception ay pumuputol sa sunod-sunod na missed-opening count.",
          "Kontaken ti JRide babaen iti official support channel tapno ma-record ti approved closure wenno valid exception. Iraman ti apektado a petsa, rason, ken available a proof. Ti basta panangserra iti app wenno panangbaybay-a iti tindaan nga offline ket saan nga approved closure. Ti approved closure wenno valid system exception ket mangputol iti agsasaruno a missed-opening count."
        ),
      },
      {
        question: t(
          "How long is an automatic suspension?",
          "Gaano katagal ang automatic suspension?",
          "Kasano kabayag ti automatic suspension?"
        ),
        answer: t(
          "The first automatic suspension for an offense lasts 7 days. When the same offense reaches its threshold again after a prior valid automatic suspension, the next suspension lasts 30 days. Unanswered-order offenses and missed-opening offenses have separate repeat histories.",
          "Ang unang automatic suspension para sa isang offense ay 7 araw. Kapag naabot ulit ng parehong offense ang threshold pagkatapos ng naunang valid automatic suspension, 30 araw ang susunod na suspension. Magkahiwalay ang repeat history ng unanswered-order offense at missed-opening offense.",
          "Ti umuna nga automatic suspension para iti maysa nga offense ket 7 aldaw. No maabot manen ti isu met laeng nga offense ti threshold kalpasan ti immun-una a valid automatic suspension, 30 aldaw ti sumaruno a suspension. Naisina ti repeat history ti unanswered-order offense ken missed-opening offense."
        ),
      },
      {
        question: t(
          "Is an automatic suspension imposed by a JRide employee?",
          "Empleyado ba ng JRide ang naglalagay ng automatic suspension?",
          "Empleyado kadi ti JRide ti mangikabil iti automatic suspension?"
        ),
        answer: t(
          "No. The vendor compliance system applies these two measurable rules from recorded platform activity. The same thresholds apply to every vendor. A JRide administrator manually reviews an automatic sanction only after the vendor submits a valid dispute that identifies the record believed to be wrong.",
          "Hindi. Ang vendor compliance system ang nagpapatupad ng dalawang measurable rules na ito gamit ang recorded platform activity. Pareho ang thresholds para sa lahat ng vendor. Mano-manong rerepasuhin lamang ng JRide administrator ang automatic sanction kapag nagsumite ang vendor ng valid dispute at tinukoy kung aling record ang pinaniniwalaang mali.",
          "Saan. Ti vendor compliance system ti mangipatungpal kadagitoy a dua a measurable rules manipud iti recorded platform activity. Agpada dagiti threshold para kadagiti amin a vendor. Manual laeng a repasuen ti JRide administrator ti automatic sanction no nagsubmit ti vendor iti valid dispute ken intudo na no ania a record ti patienna a saan nga umno."
        ),
      },
      {
        question: t(
          "What happens while my store is suspended?",
          "Ano ang mangyayari habang suspended ang store ko?",
          "Ania ti mapasamak bayat a suspended ti tindaan ko?"
        ),
        answer: t(
          "You can still enter the Vendor Portal, view records, and manage allowed store information. New Takeout orders are blocked. Pending orders that were not yet accepted are cancelled, while orders accepted before the suspension can still be completed. When the suspension ends or is revoked, the store remains closed until you manually open it again.",
          "Makakapasok pa rin kayo sa Vendor Portal, makakakita ng records, at makakapag-manage ng pinapayagang store information. Naka-block ang bagong Takeout orders. Ang pending orders na hindi pa na-accept ay makakansela, habang ang orders na na-accept bago ang suspension ay maaari pang kumpletuhin. Kapag natapos o na-revoke ang suspension, mananatiling closed ang store hanggang manual ninyo itong buksan ulit.",
          "Mabalin pay a sumrek iti Vendor Portal, kitaen dagiti records, ken manage-en dagiti napalubosan a store information. Ma-block dagiti baro a Takeout orders. Ma-cancel dagiti pending orders a saan pay a na-accept, bayat a dagiti orders a na-accept sakbay ti suspension ket mabalin pay a kompletoen. No malpas wenno ma-revoke ti suspension, agtalinaed a closed ti tindaan agingga a manual yo a lukatan manen."
        ),
      },
      {
        question: t(
          "What happens if I do not acknowledge the suspension notice?",
          "Ano ang mangyayari kung hindi ko i-acknowledge ang suspension notice?",
          "Ania ti mapasamak no saan ko nga i-acknowledge ti suspension notice?"
        ),
        answer: t(
          "The suspension remains active and its end date does not change. The full notice continues to appear whenever you open the Vendor Portal until acknowledgment is recorded. Acknowledging only confirms that you received and read the notice. It does not mean you agree with the finding or give up your right to dispute it. You do not need to sign out, sign in again, or enter a Vendor ID.",
          "Mananatiling active ang suspension at hindi magbabago ang end date nito. Patuloy na lalabas ang full notice tuwing bubuksan ang Vendor Portal hanggang ma-record ang acknowledgment. Ang pag-acknowledge ay kumpirmasyon lamang na natanggap at nabasa ninyo ang notice. Hindi ibig sabihin na sang-ayon kayo o isinuko ninyo ang karapatang mag-dispute. Hindi kailangang mag-sign out, mag-sign in ulit, o mag-enter ng Vendor ID.",
          "Agtalinaed nga active ti suspension ken saan nga agbaliw ti end date na. Agpakita latta ti full notice iti tunggal pananglukat iti Vendor Portal agingga a ma-record ti acknowledgment. Ti panang-acknowledge ket mangpatalged laeng nga naawat ken nabasa ti notice. Saan daytoy a kayatna a sawen nga umanamongkayo wenno inted yo ti karbengan yo nga ag-dispute. Saan a masapul nga ag-sign out, ag-sign in manen, wenno ag-enter iti Vendor ID."
        ),
      },
      {
        question: t(
          "How do I question or dispute a suspension?",
          "Paano ako magtatanong o magdi-dispute ng suspension?",
          "Kasanoak nga agsaludsod wenno ag-dispute iti suspension?"
        ),
        answer: t(
          "Open the full suspension notice and choose QUESTION OR DISPUTE THIS SUSPENSION. The portal prepares a message to info@jride.net with your vendor and suspension reference already attached. State which recorded activity is wrong and include the order code, date, approved closure, or supporting evidence. Filing a dispute does not pause the suspension. Manual review opens only for a valid dispute.",
          "Buksan ang full suspension notice at piliin ang QUESTION OR DISPUTE THIS SUSPENSION. Maghahanda ang portal ng message sa info@jride.net na may naka-attach nang vendor at suspension reference. Tukuyin kung aling recorded activity ang mali at isama ang order code, date, approved closure, o supporting evidence. Hindi pinapahinto ng dispute ang suspension. Magbubukas lamang ang manual review para sa valid dispute.",
          "Lukatan ti full suspension notice ket pilien ti QUESTION OR DISPUTE THIS SUSPENSION. Mangisagana ti portal iti message para iti info@jride.net a nakairamanen ti vendor ken suspension reference. Itudo no ania a recorded activity ti saan nga umno ken iraman ti order code, petsa, approved closure, wenno supporting evidence. Saan a pasardengen ti dispute ti suspension. Malukatan laeng ti manual review para iti valid dispute."
        ),
      },
      {
        question: t(
          "Can other serious violations also suspend a store?",
          "Puwede rin bang ma-suspend ang store dahil sa ibang serious violations?",
          "Mabalin kadi a ma-suspend ti tindaan gapu iti dadduma a serious violations?"
        ),
        answer: t(
          "Yes. The two threshold rules above are automatic. JRide can also suspend a store after reviewing a confirmed customer complaint, false or misleading menu information, price or order manipulation, abusive conduct, food or product safety concerns, or another confirmed vendor participation rule violation.",
          "Oo. Automatic ang dalawang threshold rules sa itaas. Puwede ring i-suspend ng JRide ang store pagkatapos repasuhin ang confirmed customer complaint, false o misleading menu information, price o order manipulation, abusive conduct, food o product safety concern, o iba pang confirmed vendor participation rule violation.",
          "Wen. Automatic dagiti dua a threshold rules iti ngato. Mabalin met nga i-suspend ti JRide ti tindaan kalpasan a narepaso ti confirmed customer complaint, false wenno misleading menu information, price wenno order manipulation, abusive conduct, food wenno product safety concern, wenno sabali a confirmed vendor participation rule violation."
        ),
      },
    ],
  },
  {
    title: t(
      "Store hours and daily availability",
      "Oras ng tindahan at araw-araw na availability",
      "Oras ti tindaan ken inaldaw nga availability"
    ),
    items: [
      {
        question: t(
          "Why do I need to set my normal opening and closing time?",
          "Bakit kailangan kong ilagay ang normal opening at closing time?",
          "Apay a masapul nga ikabil ko ti normal opening ken closing time?"
        ),
        answer: t(
          "JRide uses these times as your normal ordering window. New customer orders are blocked after your closing time. Set the hours that your store normally follows and observe any local curfew or closing rules in your area.",
          "Ginagamit ng JRide ang oras na ito bilang normal ordering window ng tindahan. Hindi na makakapaglagay ng bagong order ang customer pagkatapos ng closing time. Ilagay ang oras na normal ninyong sinusunod at sundin ang curfew o local closing rules sa inyong lugar.",
          "Usaren ti JRide dagitoy nga oras kas normal ordering window ti tindaan. Saanen a maka-order ti customer kalpasan ti closing time. Ikabil ti oras a gagangay a suroten ti tindaan ken suroten dagiti curfew wenno local closing rules iti lugaryo."
        ),
      },
      {
        question: t(
          "Does JRide automatically open my store every day?",
          "Awtomatikong binubuksan ba ng JRide ang store ko araw-araw?",
          "Automatiko kadi nga lukatan ti JRide ti tindaan ko iti tunggal aldaw?"
        ),
        answer: t(
          "No. Your store stays OFFLINE until you open the Vendor Portal and choose OPEN FOR ORDERS TODAY. You must do this each operating day when you are ready to receive orders. Opening the app or browser and saving business hours do not turn the store on. Three consecutive missed manual openings without an approved exception automatically trigger suspension.",
          "Hindi. Mananatiling OFFLINE ang store hanggang buksan ninyo ang Vendor Portal at piliin ang OPEN FOR ORDERS TODAY. Gawin ito bawat operating day kapag handa na kayong tumanggap ng orders. Hindi ino-on ng pagbukas ng app o browser at saved business hours ang store. Tatlong sunod-sunod na missed manual openings na walang approved exception ay awtomatikong magti-trigger ng suspension.",
          "Saan. Agtalinaed nga OFFLINE ti tindaan agingga a lukatan yo ti Vendor Portal ken pilien ti OPEN FOR ORDERS TODAY. Aramiden daytoy iti tunggal operating day no nakasaganakayo nga umawat ti orders. Ti pananglukat iti app wenno browser ken saved business hours ket saan a mang-on iti tindaan. Tallo nga agsasaruno a missed manual openings nga awan approved exception ket automatiko a mang-trigger iti suspension."
        ),
      },
      {
        question: t(
          "Do I need to enter my business hours every day?",
          "Kailangan ko bang ilagay ulit ang business hours araw-araw?",
          "Masapul kadi nga ikabil ko manen ti business hours iti tunggal aldaw?"
        ),
        answer: t(
          "No. Save your normal opening and closing time once, then change it only when your regular schedule changes. What you must do each operating day is manually open the store through OPEN FOR ORDERS TODAY.",
          "Hindi. I-save ang normal opening at closing time isang beses at baguhin lamang kapag nagbago ang regular schedule. Ang kailangang gawin bawat operating day ay manual na buksan ang store sa pamamagitan ng OPEN FOR ORDERS TODAY.",
          "Saan. I-save ti normal opening ken closing time maminsan, ket baliwan laeng no nagbaliw ti regular schedule. Ti masapul nga aramiden iti tunggal operating day ket manual a lukatan ti tindaan babaen ti OPEN FOR ORDERS TODAY."
        ),
      },
      {
        question: t(
          "Can I set overnight business hours?",
          "Puwede ba akong mag-set ng overnight business hours?",
          "Mabalin kadi nga ag-set iti overnight business hours?"
        ),
        answer: t(
          "No, not at this time. Closing time must be later than opening time on the same day. JRide Takeout is currently designed around the normal local store hours and curfew conditions in the service towns.",
          "Hindi sa ngayon. Dapat mas late ang closing time kaysa opening time sa parehong araw. Ang JRide Takeout ay kasalukuyang nakaayos para sa normal na oras ng mga tindahan at curfew conditions sa mga service town.",
          "Saan pay ita. Masapul a naladladaw ti closing time ngem ti opening time iti isu met laeng nga aldaw. Ti JRide Takeout ket naurnos ita para iti normal nga oras dagiti tindaan ken curfew conditions kadagiti service town."
        ),
      },
      {
        question: t(
          "What happens when my normal closing time is near?",
          "Ano ang mangyayari kapag malapit na ang normal closing time?",
          "Ania ti mapasamak no asidegen ti normal closing time?"
        ),
        answer: t(
          "If the Vendor Portal is open, JRide shows a reminder about 15 minutes before your configured closing time. You can close on schedule or extend by 30 or 60 minutes if your store can still operate and local curfew rules allow it.",
          "Kapag bukas ang Vendor Portal, magpapakita ang JRide ng reminder mga 15 minuto bago ang naka-set na closing time. Puwede kayong magsara ayon sa schedule o mag-extend ng 30 o 60 minuto kung kaya pang mag-operate ng store at pinapayagan ng local curfew rules.",
          "No nakalukat ti Vendor Portal, mangipakita ti JRide iti reminder agarup 15 minutos sakbay ti na-set a closing time. Mabalin nga agserra ayon iti schedule wenno ag-extend iti 30 wenno 60 minutos no mabalin pay nga ag-operate ti tindaan ken palubosan dagiti local curfew rules."
        ),
      },
      {
        question: t(
          "What happens if I do nothing at closing time?",
          "Ano ang mangyayari kung wala akong gawin sa closing time?",
          "Ania ti mapasamak no awan ti aramidek iti closing time?"
        ),
        answer: t(
          "JRide automatically blocks NEW customer orders at closing time. Orders already accepted or already in progress must still be completed normally.",
          "Awtomatikong iba-block ng JRide ang BAGONG customer orders sa closing time. Ang mga order na na-accept na o kasalukuyang pinoproseso ay kailangan pa ring kumpletuhin nang normal.",
          "Automatiko nga iblock ti JRide dagiti BARO a customer orders iti closing time. Dagiti order a na-accepten wenno agtultuloyen ti proseso ket masapul latta a kompletoen a normal."
        ),
      },
      {
        question: t(
          "What if I need to close early?",
          "Paano kung kailangan kong magsara nang mas maaga?",
          "Kasano no masapul nga agserra kami iti nasapsapa?"
        ),
        answer: t(
          "Use the CLOSED control in the Vendor Portal. New orders stop immediately. Your saved normal hours do not force the store to remain open. If the store will not open at all for an operating day, contact JRide for an approved closure or valid exception.",
          "Gamitin ang CLOSED control sa Vendor Portal. Hihinto agad ang bagong orders. Hindi kayo pipilitin ng saved normal hours na manatiling open. Kung hindi talaga magbubukas ang store sa isang operating day, kontakin ang JRide para sa approved closure o valid exception.",
          "Usaren ti CLOSED control iti Vendor Portal. Agsardeng a dagus dagiti baro nga orders. Saan nga piliten ti saved normal hours nga agtalinaed a nakalukat ti tindaan. No saan pulos a malukatan ti tindaan iti maysa nga operating day, kontaken ti JRide para iti approved closure wenno valid exception."
        ),
      },
    ],
  },
  {
    title: t(
      "Receiving and handling Takeout orders",
      "Pagtanggap at pag-handle ng Takeout orders",
      "Panagawat ken panang-asikaso kadagiti Takeout orders"
    ),
    items: [
      {
        question: t(
          "What should I check before accepting an order?",
          "Ano ang dapat kong i-check bago i-accept ang order?",
          "Ania ti masapul a kitaek sakbay nga i-accept ti order?"
        ),
        answer: t(
          "Make sure every ordered item is available and that your store can fulfill the complete order. Do not press Accept if an item is missing, sold out, or cannot be provided. Decline the order while it is still pending instead. A timely decline is a valid response and does not count as an unanswered or expired order.",
          "Siguraduhing available ang lahat ng item at kayang kumpletuhin ng store ang buong order. Huwag pindutin ang Accept kung may kulang, sold out, o hindi maibibigay na item. I-decline ang order habang pending pa. Ang pag-decline sa tamang oras ay valid response at hindi mabibilang na unanswered o expired order.",
          "Siguraduen nga adda amin dagiti na-order nga item ken kabaelan ti tindaan a kompletoen ti entero nga order. Saan a pinduten ti Accept no adda kurang, sold out, wenno saan a maited nga item. I-decline ti order bayat a pending pay. Ti nasapa a panang-decline ket valid response ken saan a maibilang kas unanswered wenno expired order."
        ),
      },
      {
        question: t(
          "What should I do after accepting an order?",
          "Ano ang gagawin ko pagkatapos i-accept ang order?",
          "Ania ti aramidek kalpasan nga i-accept ti order?"
        ),
        answer: t(
          "Do not cook, assemble, or finalize the order yet. Confirm that all accepted items are available and get the ingredients, stock, packaging, or other needed materials ready. Then wait for JRide to assign a driver. The driver proposes the delivery fee. Start preparing the actual order only after the passenger accepts the driver's Proposed Fare.",
          "Huwag munang lutuin, buuin, o i-finalize ang order. Siguraduhin muna na available ang lahat ng na-accept na item at ihanda lamang ang ingredients, stock, packaging, at iba pang kailangan. Pagkatapos, hintayin munang ma-assign ang driver. Ang driver ang magpo-propose ng delivery fee. Saka lamang simulan ang aktuwal na paghahanda ng order kapag tinanggap ng passenger ang Proposed Fare ng driver.",
          "Saan pay nga lutoen, kompletoen, wenno i-finalize ti order. Siguraduen nga adda amin dagiti na-accept nga item ken isagana laeng dagiti ingredients, stock, packaging, ken dadduma a kasapulan. Kalpasanna, urayen nga ma-assign ti driver. Ti driver ti mang-propose iti delivery fee. Mangrugi laeng iti aktuwal a panangisagana ti order no inakseptar ti passenger ti Proposed Fare ti driver."
        ),
      },
      {
        question: t(
          "Why should I wait for the passenger to accept the driver's Proposed Fare?",
          "Bakit kailangan kong hintayin na i-accept ng passenger ang Proposed Fare ng driver?",
          "Apay a masapul nga urayek nga i-accept ti passenger ti Proposed Fare ti driver?"
        ),
        answer: t(
          "Vendor acceptance only confirms that the items are available. The Takeout order should be prepared for final fulfillment only after a driver is assigned, proposes the delivery fee, and the passenger accepts that Proposed Fare. This avoids preparing an order that may not proceed.",
          "Ang vendor acceptance ay kumpirmasyon lamang na available ang mga item. Dapat lang ihanda para sa final fulfillment ang Takeout order kapag may assigned driver na, nakapag-propose na siya ng delivery fee, at tinanggap na ng passenger ang Proposed Fare. Nakakaiwas ito sa paghahanda ng order na maaaring hindi tumuloy.",
          "Ti vendor acceptance ket kumpirmasion laeng nga adda dagiti item. Masapul laeng nga isagana para iti final fulfillment ti Takeout order no adda assigned driver, nakapag-propose isuna iti delivery fee, ken inakseptar ti passenger ti Proposed Fare. Daytoy ket mangliklik iti panangisagana iti order a mabalin a saan nga agtuloy."
        ),
      },
      {
        question: t(
          "Can I cancel an order after accepting it?",
          "Puwede ko bang i-cancel ang order pagkatapos ko itong i-accept?",
          "Mabalin kadi nga i-cancel ti order kalpasan nga in-accept ko?"
        ),
        answer: t(
          "NO. Before pressing Accept, make sure every item is available and your store can complete the order. Once the vendor accepts the order, vendor cancellation is no longer allowed. If a real emergency makes fulfillment impossible, contact JRide admin immediately. An emergency cancellation must be handled as an admin exception, not as a normal vendor cancellation.",
          "HINDI. Bago pindutin ang Accept, siguraduhing available ang lahat ng item at kayang kumpletuhin ng store ang order. Kapag na-accept na ng vendor ang order, hindi na puwedeng i-cancel ng vendor. Kung may tunay na emergency at imposibleng kumpletuhin ang order, kontakin agad ang JRide admin. Ang emergency cancellation ay admin exception at hindi normal vendor cancellation.",
          "SAAN. Sakbay a pinduten ti Accept, siguraduen nga adda amin dagiti item ken kabaelan ti tindaan a kompletoen ti order. No na-accepten ti vendor ti order, saanen a mabalin nga i-cancel ti vendor. No adda pudno nga emergency ket saanen a mabalin a kompletoen ti order, kontaken a dagus ti JRide admin. Ti emergency cancellation ket admin exception, saan a normal vendor cancellation."
        ),
      },
      {
        question: t(
          "What if I cannot fulfill the order before I accept it?",
          "Paano kung hindi ko kayang kumpletuhin ang order bago ko ito i-accept?",
          "Kasano no saan ko a kabaelan a kompletoen ti order sakbay nga i-accept?"
        ),
        answer: t(
          "Decline the order while it is still pending and choose the correct reason. This is the proper time to decline because no vendor commitment has been made yet. Do not leave the order unanswered until it expires.",
          "I-decline ang order habang pending pa at piliin ang tamang dahilan. Ito ang tamang oras para mag-decline dahil wala pang vendor commitment. Huwag hayaang unanswered ang order hanggang mag-expire.",
          "I-decline ti order bayat a pending pay ken pilien ti umno a rason. Daytoy ti umno a tiempo nga ag-decline gapu ta awan pay ti vendor commitment. Saan a baybay-an ti order nga unanswered agingga a mag-expire."
        ),
      },
      {
        question: t(
          "What if the customer asks for a receipt?",
          "Paano kung humingi ng resibo ang customer?",
          "Kasano no agkiddaw ti customer iti resibo?"
        ),
        answer: t(
          "Check the order details. If Vendor receipt requested is shown, include the store receipt with the order.",
          "I-check ang order details. Kapag nakalagay ang Vendor receipt requested, isama ang resibo ng store sa order.",
          "Kitaen dagiti order details. No makita ti Vendor receipt requested, iraman ti resibo ti tindaan iti order."
        ),
      },
    ],
  },
  {
    title: t(
      "Menu and item availability",
      "Menu at item availability",
      "Menu ken item availability"
    ),
    items: [
      {
        question: t(
          "What should I do when an item is sold out?",
          "Ano ang gagawin kapag sold out ang item?",
          "Ania ti aramiden no sold out ti item?"
        ),
        answer: t(
          "Mark the item unavailable or sold out in the Vendor Portal immediately so customers cannot order it.",
          "I-mark agad ang item bilang unavailable o sold out sa Vendor Portal para hindi na ito ma-order ng customer.",
          "I-mark a dagus ti item kas unavailable wenno sold out iti Vendor Portal tapno saanen a ma-order ti customer."
        ),
      },
      {
        question: t(
          "Is store availability the same as item availability?",
          "Pareho ba ang store availability at item availability?",
          "Agpada kadi ti store availability ken item availability?"
        ),
        answer: t(
          "No. Store availability controls whether your store can receive new orders. Item availability controls whether a specific menu item can be ordered. Keep both accurate.",
          "Hindi. Ang store availability ang nagkokontrol kung puwedeng tumanggap ng bagong order ang store. Ang item availability naman ang nagkokontrol kung puwedeng i-order ang isang partikular na item. Panatilihing tama ang pareho.",
          "Saan. Ti store availability ti mangkontrol no mabalin nga umawat ti tindaan iti baro nga order. Ti item availability ti mangkontrol no mabalin a ma-order ti maysa a menu item. Siguraduen nga husto dagitoy a dua."
        ),
      },
      {
        question: t(
          "How do I update my menu?",
          "Paano ko ia-update ang menu?",
          "Kasano nga i-update ti menu?"
        ),
        answer: t(
          "Use the menu section in the Vendor Portal to update item names, descriptions, prices, photos, preparation times, variants, add-ons, and availability.",
          "Gamitin ang menu section sa Vendor Portal para i-update ang item name, description, price, photo, preparation time, variants, add-ons, at availability.",
          "Usaren ti menu section iti Vendor Portal tapno i-update ti item name, description, price, photo, preparation time, variants, add-ons, ken availability."
        ),
      },
    ],
  },
  {
    title: t(
      "Alerts and troubleshooting",
      "Alerts at troubleshooting",
      "Alerts ken troubleshooting"
    ),
    items: [
      {
        question: t(
          "How do I make sure I hear new order alerts?",
          "Paano ko masisigurong maririnig ko ang bagong order alert?",
          "Kasano a masiguradok a mangngeg ko ti baro nga order alert?"
        ),
        answer: t(
          "Keep the Vendor Portal open during service hours, enable vendor sound, allow notifications when requested, and use Test sound to confirm that audio works on the device. Check the live order queue regularly because an order that expires without Accept or Decline is added to the accumulated unanswered-order count.",
          "Panatilihing bukas ang Vendor Portal habang tumatanggap ng orders, i-enable ang vendor sound, payagan ang notifications kapag hiningi, at gamitin ang Test sound para masigurong gumagana ang audio sa device. Regular na i-check ang live order queue dahil ang order na nag-expire nang walang Accept o Decline ay idinadagdag sa naipong unanswered-order count.",
          "Pagtalinaeden a nakalukat ti Vendor Portal bayat ti service hours, i-enable ti vendor sound, palubosan dagiti notifications no maidawat, ken usaren ti Test sound tapno masigurado a gumagana ti audio iti device. Regular a kitaen ti live order queue gapu ta ti order a nag-expire nga awan ti Accept wenno Decline ket mainayon iti naurnong nga unanswered-order count."
        ),
      },
      {
        question: t(
          "What if my internet connection is unstable?",
          "Paano kung mahina o unstable ang internet?",
          "Kasano no nakapuy wenno unstable ti internet?"
        ),
        answer: t(
          "A weak connection can delay the live order queue and alerts. Use a stable connection during service hours and check the Vendor Portal regularly. If a verified system or connection problem caused an incorrect compliance record, open the suspension notice and submit a valid dispute with the booking code, time, and available evidence.",
          "Maaaring ma-delay ang live order queue at alerts kapag mahina ang internet. Gumamit ng stable connection habang tumatanggap ng orders at regular na i-check ang Vendor Portal. Kung may verified system o connection problem na nagdulot ng maling compliance record, buksan ang suspension notice at magsumite ng valid dispute na may booking code, oras, at available na evidence.",
          "Mabalin a ma-delay ti live order queue ken alerts no nakapuy ti internet. Agusarkayo iti stable connection bayat ti service hours ken regular a kitaen ti Vendor Portal. No adda verified system wenno connection problem a nangpataud iti saan nga umno a compliance record, lukatan ti suspension notice ken agsubmit iti valid dispute nga addaan booking code, oras, ken available nga evidence."
        ),
      },
      {
        question: t(
          "What if the portal information does not match the actual order?",
          "Paano kung hindi tugma ang nasa portal sa aktuwal na order?",
          "Kasano no saan nga agtutunos ti adda iti portal ken ti aktuwal nga order?"
        ),
        answer: t(
          "Do not guess or change the order outside the confirmed details. Refresh the Vendor Portal first. If the problem remains, contact JRide through info@jride.net and provide the booking code, date, time, and a screenshot when available.",
          "Huwag manghula o baguhin ang order na wala sa confirmed details. I-refresh muna ang Vendor Portal. Kung nandoon pa rin ang problema, kontakin ang JRide sa info@jride.net at ibigay ang booking code, date, oras, at screenshot kung available.",
          "Saan nga agpagarup wenno agbaliw iti order a saan nga adda kadagiti confirmed details. I-refresh pay ti Vendor Portal. No adda latta ti problema, kontaken ti JRide iti info@jride.net ken ited ti booking code, petsa, oras, ken screenshot no adda."
        ),
      },
    ],
  },
];

function Section({
  section,
  language,
}: {
  section: FaqSection;
  language: Language;
}) {
  return (
    <section
      className={`rounded-3xl border bg-white p-5 shadow-sm ${
        section.featured
          ? "border-rose-200 ring-1 ring-rose-100"
          : "border-slate-200"
      }`}
    >
      {section.featured ? (
        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-rose-700">
          {PAGE_TEXT.currentRules[language]}
        </div>
      ) : null}
      <h2 className="text-lg font-bold text-slate-950">
        {section.title[language]}
      </h2>
      <div className="mt-4 space-y-3">
        {section.items.map((item, index) => (
          <details
            key={item.question.en}
            defaultOpen={section.featured === true && index === 0}
            className="group rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <summary className="cursor-pointer list-none pr-6 text-sm font-bold text-slate-900">
              {item.question[language]}
            </summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {item.answer[language]}
            </p>
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
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
            {PAGE_TEXT.eyebrow[language]}
          </div>
          <h1 className="mt-2 text-3xl font-black">
            {PAGE_TEXT.title[language]}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            {PAGE_TEXT.intro[language]}
          </p>

          <div className="mt-4 rounded-2xl border border-rose-400/50 bg-rose-500/10 p-4">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-rose-200">
              {PAGE_TEXT.currentRules[language]}
            </div>
            <p className="mt-2 text-sm leading-6 text-rose-50">
              {PAGE_TEXT.currentRulesSummary[language]}
            </p>
          </div>

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

          <a
            href="/vendor-portal"
            className="mt-4 inline-flex rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
          >
            {PAGE_TEXT.back[language]}
          </a>
        </div>

        <div className="mt-5 space-y-5">
          {SECTIONS.map((section) => (
            <Section
              key={section.title.en}
              section={section}
              language={language}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
