/** Demo master data + sample content. Names of villages/organisations/people below are illustrative placeholders. */

const U = (id: string) => `https://images.unsplash.com/photo-${id}`;

type Node = [string, string, string, Node[]?];

const locations: Node[] = [
  [
    "rajasthan", "राजस्थान", "Rajasthan",
    [
      ["jaipur", "जयपुर", "Jaipur", [["jaipur", "जयपुर", "Jaipur", [["sanganer", "सांगानेर", "Sanganer", [["dhani-jangidan", "ढाणी जांगिडान", "Dhani Jangidan"]]]]]]],
      ["jodhpur", "जोधपुर", "Jodhpur", [["jodhpur", "जोधपुर", "Jodhpur"]]],
      ["udaipur", "उदयपुर", "Udaipur", [["udaipur", "उदयपुर", "Udaipur"]]],
      ["sikar", "सीकर", "Sikar", [["sikar", "सीकर", "Sikar"]]],
      ["ajmer", "अजमेर", "Ajmer", [["ajmer", "अजमेर", "Ajmer"]]],
      ["bikaner", "बीकानेर", "Bikaner", [["bikaner", "बीकानेर", "Bikaner"]]],
    ],
  ],
  [
    "haryana", "हरियाणा", "Haryana",
    [
      ["rohtak", "रोहतक", "Rohtak", [["rohtak", "रोहतक", "Rohtak"]]],
      ["karnal", "करनाल", "Karnal", [["karnal", "करनाल", "Karnal"]]],
      ["hisar", "हिसार", "Hisar", [["hisar", "हिसार", "Hisar"]]],
      ["gurugram", "गुरुग्राम", "Gurugram", [["gurugram", "गुरुग्राम", "Gurugram"]]],
    ],
  ],
  [
    "delhi", "दिल्ली", "Delhi",
    [
      ["new-delhi", "नई दिल्ली", "New Delhi", [["new-delhi", "नई दिल्ली", "New Delhi"]]],
      ["south-delhi", "दक्षिण दिल्ली", "South Delhi", [["south-delhi", "दक्षिण दिल्ली", "South Delhi"]]],
    ],
  ],
  [
    "gujarat", "गुजरात", "Gujarat",
    [
      ["ahmedabad", "अहमदाबाद", "Ahmedabad", [["ahmedabad", "अहमदाबाद", "Ahmedabad"]]],
      ["surat", "सूरत", "Surat", [["surat", "सूरत", "Surat"]]],
      ["vadodara", "वडोदरा", "Vadodara", [["vadodara", "वडोदरा", "Vadodara"]]],
      ["rajkot", "राजकोट", "Rajkot", [["rajkot", "राजकोट", "Rajkot"]]],
    ],
  ],
  [
    "madhya-pradesh", "मध्य प्रदेश", "Madhya Pradesh",
    [
      ["indore", "इंदौर", "Indore", [["indore", "इंदौर", "Indore"]]],
      ["bhopal", "भोपाल", "Bhopal", [["bhopal", "भोपाल", "Bhopal"]]],
      ["jabalpur", "जबलपुर", "Jabalpur", [["jabalpur", "जबलपुर", "Jabalpur"]]],
    ],
  ],
  [
    "uttar-pradesh", "उत्तर प्रदेश", "Uttar Pradesh",
    [
      ["agra", "आगरा", "Agra", [["agra", "आगरा", "Agra"]]],
      ["lucknow", "लखनऊ", "Lucknow", [["lucknow", "लखनऊ", "Lucknow"]]],
      ["kanpur", "कानपुर", "Kanpur", [["kanpur", "कानपुर", "Kanpur"]]],
      ["varanasi", "वाराणसी", "Varanasi", [["varanasi", "वाराणसी", "Varanasi"]]],
    ],
  ],
];

const categories: [string, string, string][] = [
  ["national", "राष्ट्रीय", "National"],
  ["international", "अंतरराष्ट्रीय", "International"],
  ["samaj", "समाज", "Community"],
  ["business", "व्यापार", "Business"],
  ["social", "सामाजिक कार्य", "Social Work"],
  ["rishte", "रिश्ते", "Matrimony"],
  ["gotra", "गोत्र", "Gotra"],
  ["sports", "खेल", "Sports"],
  ["education", "शिक्षा", "Education"],
  ["jobs", "रोज़गार", "Jobs"],
];

const tags: [string, string, string][] = [
  ["parichay-sammelan", "परिचय सम्मेलन", "Introduction Conference"],
  ["gotra-suchi", "गोत्र सूची", "Gotra List"],
  ["samaj-chunav", "समाज चुनाव", "Samaj Elections"],
  ["vyapar-mela", "व्यापार मेला", "Business Fair"],
  ["chhatravritti", "छात्रवृत्ति", "Scholarship"],
];

interface NewsSeed {
  slug: string;
  category: string;
  location?: string;
  image: string;
  publishedAt: string;
  breaking?: boolean;
  featured?: boolean;
  tags?: string[];
  hi: { title: string; excerpt: string; body: string[]; imageAlt: string };
  en: { title: string; excerpt: string; body: string[]; imageAlt: string };
}

const news: NewsSeed[] = [
  {
    slug: "jaipur-samaj-parichay-sammelan-2026", category: "samaj", location: "rajasthan/jaipur/jaipur", image: U("1477587458883-47145ed94245"),
    publishedAt: "2026-09-24T09:30:00+05:30", breaking: true, featured: true, tags: ["parichay-sammelan"],
    hi: {
      title: "जयपुर में जांगिड़ समाज का वार्षिक परिचय सम्मेलन 15 मार्च को, हजारों परिवार होंगे शामिल",
      excerpt: "समाज भवन, जयपुर में तीन दिन चलने वाले सम्मेलन में युवा परिचय, सम्मान समारोह और सांस्कृतिक कार्यक्रम होंगे।",
      body: ["समाज भवन, जयपुर में इस बार सम्मेलन का आयोजन तीन दिन तक चलेगा, जिसमें युवा परिचय, सम्मान समारोह और सांस्कृतिक कार्यक्रम शामिल होंगे।", "आयोजन समिति के अनुसार देशभर से हजारों परिवारों के पहुंचने की उम्मीद है। ऑनलाइन पंजीयन समाज की वेबसाइट पर भी उपलब्ध रहेगा।"],
      imageAlt: "जयपुर का हवा महल",
    },
    en: {
      title: "Jangid Samaj's annual introduction conference in Jaipur on March 15, thousands of families to attend",
      excerpt: "The three-day event at Samaj Bhawan, Jaipur will include youth introductions, felicitation and cultural programs.",
      body: ["The three-day event at Samaj Bhawan, Jaipur will include youth introductions, felicitation and cultural programs.", "According to the organising committee, thousands of families from across the country are expected. Online registration will also be available on the samaj website."],
      imageAlt: "Hawa Mahal in Jaipur",
    },
  },
  {
    slug: "jodhpur-udyami-samman", category: "business", location: "rajasthan/jodhpur/jodhpur", image: U("1556761175-5973dc0f32e7"),
    publishedAt: "2026-09-24T08:10:00+05:30", tags: ["vyapar-mela"],
    hi: {
      title: "जोधपुर के 5 जांगिड़ समाज व्यापारियों को मिला 'उद्यमी सम्मान', सालाना कारोबार करोड़ों में",
      excerpt: "जोधपुर व्यापार मंडल ने समाज के होनहार व्यापारियों को मंच पर सम्मानित किया।",
      body: ["जोधपुर व्यापार मंडल ने समाज के होनहार व्यापारियों को मंच पर सम्मानित किया। समाज अध्यक्ष कार्यक्रम के मुख्य अतिथि रहे।", "सम्मानित व्यापारियों ने फर्नीचर, निर्माण और हस्तशिल्प क्षेत्र में उल्लेखनीय काम किया है।"],
      imageAlt: "व्यापारिक बैठक",
    },
    en: {
      title: "Five Jangid Samaj entrepreneurs from Jodhpur honoured with 'Udyami Samman'",
      excerpt: "Jodhpur trade body felicitated promising community entrepreneurs on stage.",
      body: ["The Jodhpur trade body felicitated promising community entrepreneurs on stage. The samaj president was the chief guest.", "The honoured entrepreneurs have done notable work in furniture, construction and handicrafts."],
      imageAlt: "Business meeting",
    },
  },
  {
    slug: "udaipur-chhatravritti-yojana", category: "education", location: "rajasthan/udaipur/udaipur", image: U("1503428593586-e225b39bddfe"),
    publishedAt: "2026-09-23T17:45:00+05:30", tags: ["chhatravritti"],
    hi: {
      title: "उदयपुर में समाज की छात्रवृत्ति योजना शुरू, मेधावी विद्यार्थियों को मिलेगी आर्थिक मदद",
      excerpt: "कक्षा 10 और 12 में 80% से अधिक अंक लाने वाले विद्यार्थी आवेदन कर सकेंगे।",
      body: ["कक्षा 10 और 12 में 80% से अधिक अंक लाने वाले विद्यार्थी आवेदन कर सकेंगे।", "आवेदन की अंतिम तिथि 30 अक्टूबर है और चयनित विद्यार्थियों को समारोह में सम्मानित किया जाएगा।"],
      imageAlt: "पढ़ाई करते विद्यार्थी",
    },
    en: {
      title: "Udaipur launches samaj scholarship scheme for meritorious students",
      excerpt: "Students scoring above 80% in classes 10 and 12 can apply.",
      body: ["Students scoring above 80% in classes 10 and 12 can apply.", "The last date to apply is October 30 and selected students will be honoured at a ceremony."],
      imageAlt: "Students studying",
    },
  },
  {
    slug: "rohtak-rakt-daan-shivir", category: "social", location: "haryana/rohtak/rohtak", image: U("1469571486292-0ba58a3f068b"),
    publishedAt: "2026-09-24T07:20:00+05:30",
    hi: {
      title: "हरियाणा समाज इकाई ने लगाया रक्तदान शिविर, 200 यूनिट रक्त संग्रह",
      excerpt: "रोहतक स्थित समाज भवन में आयोजित शिविर में युवाओं ने बढ़-चढ़कर हिस्सा लिया।",
      body: ["रोहतक स्थित समाज भवन में आयोजित शिविर में युवाओं ने बढ़-चढ़कर हिस्सा लिया।", "एकत्र रक्त जिला अस्पताल की ब्लड बैंक को सौंपा गया।"],
      imageAlt: "हाथों से बना दिल",
    },
    en: {
      title: "Haryana samaj unit organises blood donation camp, collects 200 units",
      excerpt: "Youth participated enthusiastically in the camp at the Samaj Bhawan in Rohtak.",
      body: ["Youth participated enthusiastically in the camp at the Samaj Bhawan in Rohtak.", "The collected blood was handed over to the district hospital's blood bank."],
      imageAlt: "Hands forming a heart",
    },
  },
  {
    slug: "karnal-khel-pratiyogita", category: "sports", location: "haryana/karnal/karnal", image: U("1461896836934-ffe607ba8211"),
    publishedAt: "2026-09-23T15:00:00+05:30",
    hi: {
      title: "करनाल में समाज की खेल प्रतियोगिता, 12 जिलों की टीमें पहुंचीं",
      excerpt: "एथलेटिक्स, कबड्डी और वॉलीबॉल में प्रतियोगिता हुई।",
      body: ["एथलेटिक्स, कबड्डी और वॉलीबॉल में प्रतियोगिता हुई।", "विजेताओं को ट्रॉफी और नकद पुरस्कार दिए गए।"],
      imageAlt: "दौड़ के लिए तैयार धावक",
    },
    en: {
      title: "Karnal hosts samaj sports meet with teams from 12 districts",
      excerpt: "Athletics, kabaddi and volleyball events were held.",
      body: ["Athletics, kabaddi and volleyball events were held.", "Winners received trophies and cash prizes."],
      imageAlt: "Sprinter at the starting line",
    },
  },
  {
    slug: "delhi-ncr-parichay-sammelan", category: "rishte", location: "delhi/new-delhi/new-delhi", image: U("1511632765486-a01980e01a18"),
    publishedAt: "2026-09-23T12:30:00+05:30", tags: ["parichay-sammelan"],
    hi: {
      title: "दिल्ली-एनसीआर परिचय सम्मेलन में 300 युवाओं ने कराया पंजीयन",
      excerpt: "सम्मेलन ऑनलाइन पंजीयन सुविधा के साथ आयोजित हुआ।",
      body: ["इस वर्ष का सम्मेलन ऑनलाइन पंजीयन सुविधा के साथ आयोजित हुआ, समाज वेबसाइट से भी आवेदन संभव था।", "परिवारों ने बायोडाटा का आदान-प्रदान किया और आगे की बातचीत तय की।"],
      imageAlt: "सूर्यास्त में साथ खड़े युवा",
    },
    en: {
      title: "300 youths register at Delhi-NCR introduction conference",
      excerpt: "The event offered online registration.",
      body: ["This year's event offered online registration, and applications were also accepted via the samaj website.", "Families exchanged biodata and planned follow-up conversations."],
      imageAlt: "Young people together at sunset",
    },
  },
  {
    slug: "delhi-samaj-bhawan-shilanyas", category: "samaj", location: "delhi/new-delhi/new-delhi", image: U("1582213782179-e0d53f98f2ca"),
    publishedAt: "2026-09-22T18:00:00+05:30",
    hi: {
      title: "दिल्ली में नए समाज भवन का शिलान्यास, 2027 तक तैयार होगा",
      excerpt: "भवन में सभागार, पुस्तकालय और अतिथि कक्ष होंगे।",
      body: ["भवन में सभागार, पुस्तकालय और अतिथि कक्ष होंगे।", "निर्माण का खर्च समाज के सदस्यों के सहयोग से जुटाया जा रहा है।"],
      imageAlt: "एक-दूसरे का हाथ थामे लोग",
    },
    en: {
      title: "Foundation laid for new Samaj Bhawan in Delhi, ready by 2027",
      excerpt: "The building will have an auditorium, library and guest rooms.",
      body: ["The building will have an auditorium, library and guest rooms.", "The cost is being raised through contributions from samaj members."],
      imageAlt: "People holding hands together",
    },
  },
  {
    slug: "gujarat-gotra-anusandhan", category: "gotra", location: "gujarat/ahmedabad/ahmedabad", image: U("1531482615713-2afd69097998"),
    publishedAt: "2026-09-24T06:40:00+05:30", tags: ["gotra-suchi"],
    hi: {
      title: "गुजरात इकाई ने शुरू किया गोत्र अनुसंधान अभियान, पुरानी वंशावली होंगी डिजिटल",
      excerpt: "अहमदाबाद समिति पुराने परिवारों से दस्तावेज एकत्र कर रही है।",
      body: ["अहमदाबाद समिति पुराने परिवारों से दस्तावेज एकत्र कर डिजिटल गोत्र सूची तैयार कर रही है।", "सूची समाज की वेबसाइट पर सुरक्षित रूप से उपलब्ध कराई जाएगी।"],
      imageAlt: "लैपटॉप पर काम करते लोग",
    },
    en: {
      title: "Gujarat unit launches gotra research drive to digitise old lineage records",
      excerpt: "The Ahmedabad committee is collecting documents from old families.",
      body: ["The Ahmedabad committee is collecting documents from old families to prepare a digital gotra registry.", "The registry will be made available securely on the samaj website."],
      imageAlt: "People working on a laptop",
    },
  },
  {
    slug: "surat-vyapar-mela", category: "business", location: "gujarat/surat/surat", image: U("1521737604893-d14cc237f11d"),
    publishedAt: "2026-09-22T11:15:00+05:30", tags: ["vyapar-mela"],
    hi: {
      title: "सूरत में समाज व्यापार मेला, 80 से अधिक स्टॉल लगे",
      excerpt: "फर्नीचर, इंटीरियर और निर्माण सामग्री के व्यापारी जुटे।",
      body: ["फर्नीचर, इंटीरियर और निर्माण सामग्री के व्यापारी जुटे।", "मेले में व्यापारियों के बीच नए साझेदारी समझौते भी हुए।"],
      imageAlt: "टीम बैठक",
    },
    en: {
      title: "Surat samaj business fair opens with over 80 stalls",
      excerpt: "Furniture, interior and construction traders gathered.",
      body: ["Furniture, interior and construction traders gathered.", "New partnership agreements were also signed among traders at the fair."],
      imageAlt: "Team meeting",
    },
  },
  {
    slug: "indore-khel-mahotsav", category: "sports", location: "madhya-pradesh/indore/indore", image: U("1529156069898-49953e39b3ac"),
    publishedAt: "2026-09-23T10:00:00+05:30",
    hi: {
      title: "मध्य प्रदेश समाज खेल महोत्सव: इंदौर में क्रिकेट और कबड्डी की प्रतियोगिताएं शुरू",
      excerpt: "प्रदेशभर की टीमें इंदौर पहुंचीं।",
      body: ["प्रदेशभर की टीमें इंदौर पहुंचीं, विजेता टीम को ट्रॉफी और नकद पुरस्कार मिलेगा।", "फाइनल मुकाबले रविवार को खेले जाएंगे।"],
      imageAlt: "साथ खड़े दोस्तों का समूह",
    },
    en: {
      title: "MP Samaj Sports Festival: cricket and kabaddi competitions begin in Indore",
      excerpt: "Teams from across the state have arrived in Indore.",
      body: ["Teams from across the state have arrived in Indore; the winning team gets a trophy and cash prize.", "The finals will be played on Sunday."],
      imageAlt: "Group of friends together",
    },
  },
  {
    slug: "bhopal-vivah-sammelan", category: "rishte", location: "madhya-pradesh/bhopal/bhopal", image: U("1519741497674-611481863552"),
    publishedAt: "2026-09-21T19:00:00+05:30",
    hi: {
      title: "भोपाल में सामूहिक विवाह सम्मेलन, 21 जोड़ों ने लिए सात फेरे",
      excerpt: "समाज ने सभी जोड़ों को गृहस्थी का सामान भेंट किया।",
      body: ["समाज ने सभी जोड़ों को गृहस्थी का सामान भेंट किया।", "कार्यक्रम में हजारों लोगों ने आशीर्वाद दिया।"],
      imageAlt: "विवाह समारोह",
    },
    en: {
      title: "Bhopal community wedding ceremony sees 21 couples tie the knot",
      excerpt: "The samaj gifted household items to all couples.",
      body: ["The samaj gifted household items to all couples.", "Thousands of people attended to bless the couples."],
      imageAlt: "Wedding ceremony",
    },
  },
  {
    slug: "agra-samaj-milan", category: "samaj", location: "uttar-pradesh/agra/agra", image: U("1524492412937-b28074a5d7da"),
    publishedAt: "2026-09-22T16:30:00+05:30", tags: ["samaj-chunav"],
    hi: {
      title: "आगरा में समाज मिलन समारोह, नई कार्यकारिणी की घोषणा",
      excerpt: "उत्तर प्रदेश इकाई की नई टीम ने कार्यभार संभाला।",
      body: ["उत्तर प्रदेश इकाई की नई टीम ने कार्यभार संभाला।", "नई कार्यकारिणी ने युवाओं और महिलाओं की भागीदारी बढ़ाने का संकल्प लिया।"],
      imageAlt: "आगरा का ताजमहल",
    },
    en: {
      title: "Agra samaj get-together announces new executive committee",
      excerpt: "The Uttar Pradesh unit's new team has taken charge.",
      body: ["The Uttar Pradesh unit's new team has taken charge.", "The new committee pledged to increase participation of youth and women."],
      imageAlt: "Taj Mahal, Agra",
    },
  },
  {
    slug: "lucknow-yuva-rozgar-mela", category: "jobs", location: "uttar-pradesh/lucknow/lucknow", image: U("1590650153855-d9e808231d41"),
    publishedAt: "2026-09-21T13:20:00+05:30",
    hi: {
      title: "लखनऊ में युवा रोजगार मेला, 40 कंपनियों ने दिए ऑफर",
      excerpt: "समाज के युवाओं के लिए विशेष रोजगार मेला आयोजित हुआ।",
      body: ["समाज के युवाओं के लिए विशेष रोजगार मेला आयोजित हुआ।", "कई युवाओं को मौके पर ही ऑफर लेटर मिले।"],
      imageAlt: "दफ्तर में आत्मविश्वासी महिला",
    },
    en: {
      title: "Lucknow youth job fair: 40 companies make offers",
      excerpt: "A special job fair was held for youths of the samaj.",
      body: ["A special job fair was held for youths of the samaj.", "Several youths received offer letters on the spot."],
      imageAlt: "Confident professional in an office",
    },
  },
  {
    slug: "national-mahasabha-2026", category: "national", image: U("1532375810709-75b1da00537c"),
    publishedAt: "2026-09-24T10:05:00+05:30", featured: true,
    hi: {
      title: "अखिल भारतीय समाज महासभा की बैठक, डिजिटल सदस्यता अभियान पर मुहर",
      excerpt: "देशभर के प्रतिनिधि बैठक में शामिल हुए।",
      body: ["देशभर के प्रतिनिधि बैठक में शामिल हुए और डिजिटल सदस्यता अभियान को मंजूरी दी गई।", "अभियान के तहत हर परिवार का सत्यापित डिजिटल प्रोफाइल बनेगा।"],
      imageAlt: "भारत का तिरंगा",
    },
    en: {
      title: "All-India Samaj Mahasabha approves digital membership drive",
      excerpt: "Representatives from across the country attended.",
      body: ["Representatives from across the country attended and approved the digital membership drive.", "Under the drive, every family will get a verified digital profile."],
      imageAlt: "Indian national flag",
    },
  },
];

interface DirSeed {
  slug: string;
  type: "ORGANIZATION" | "COMMITTEE" | "SAMAJ_BHAWAN" | "CONTACT";
  location: string;
  verified?: boolean;
  phone?: string;
  email?: string;
  website?: string;
  pincode?: string;
  lat?: number;
  lng?: number;
  image?: string;
  year?: number;
  order?: number;
  publicContact?: boolean;
  hi: { name: string; description: string; address: string };
  en: { name: string; description: string; address: string };
}

const directory: DirSeed[] = [
  {
    slug: "akhil-bharatiya-jangid-samaj-mahasabha", type: "ORGANIZATION", location: "delhi/new-delhi/new-delhi", verified: true, year: 1962, order: 1,
    phone: "9000000001", email: "info@example.org", website: "https://example.org", image: U("1548013146-72479768bada"),
    hi: { name: "अखिल भारतीय जांगिड़ समाज महासभा", description: "देशभर की समाज इकाइयों की शीर्ष संस्था।", address: "समाज भवन, नई दिल्ली" },
    en: { name: "Akhil Bharatiya Jangid Samaj Mahasabha", description: "The apex body of samaj units across the country.", address: "Samaj Bhawan, New Delhi" },
  },
  {
    slug: "rajasthan-jangid-sabha", type: "ORGANIZATION", location: "rajasthan/jaipur/jaipur", verified: true, year: 1975, order: 2, phone: "9000000002",
    hi: { name: "राजस्थान जांगिड़ सभा", description: "राजस्थान में समाज के सामाजिक और शैक्षणिक कार्यक्रम।", address: "समाज भवन, जयपुर" },
    en: { name: "Rajasthan Jangid Sabha", description: "Social and educational programs of the samaj in Rajasthan.", address: "Samaj Bhawan, Jaipur" },
  },
  {
    slug: "jaipur-samaj-bhawan", type: "SAMAJ_BHAWAN", location: "rajasthan/jaipur/jaipur", verified: true, pincode: "302001", lat: 26.9124, lng: 75.7873, phone: "9000000003", order: 3, image: U("1600585154340-be6161a56a0c"),
    hi: { name: "जांगिड़ समाज भवन, जयपुर", description: "विवाह, सम्मेलन और सामाजिक आयोजनों के लिए सभागार व अतिथि कक्ष।", address: "जयपुर, राजस्थान" },
    en: { name: "Jangid Samaj Bhawan, Jaipur", description: "Auditorium and guest rooms for weddings, conferences and community events.", address: "Jaipur, Rajasthan" },
  },
  {
    slug: "jodhpur-samaj-bhawan", type: "SAMAJ_BHAWAN", location: "rajasthan/jodhpur/jodhpur", verified: true, pincode: "342001", phone: "9000000004",
    hi: { name: "जांगिड़ समाज भवन, जोधपुर", description: "समाज के कार्यक्रमों के लिए भवन।", address: "जोधपुर, राजस्थान" },
    en: { name: "Jangid Samaj Bhawan, Jodhpur", description: "Hall for community programs.", address: "Jodhpur, Rajasthan" },
  },
  {
    slug: "rohtak-samaj-bhawan", type: "SAMAJ_BHAWAN", location: "haryana/rohtak/rohtak", verified: true, pincode: "124001", phone: "9000000005",
    hi: { name: "जांगिड़ समाज भवन, रोहतक", description: "रक्तदान शिविर और सामाजिक आयोजनों का केंद्र।", address: "रोहतक, हरियाणा" },
    en: { name: "Jangid Samaj Bhawan, Rohtak", description: "Centre for blood donation camps and community events.", address: "Rohtak, Haryana" },
  },
  {
    slug: "ahmedabad-jangid-mandal", type: "ORGANIZATION", location: "gujarat/ahmedabad/ahmedabad", verified: true, phone: "9000000006",
    hi: { name: "अहमदाबाद जांगिड़ मंडल", description: "गुजरात में गोत्र अनुसंधान और सामाजिक मेल-मिलाप।", address: "अहमदाबाद, गुजरात" },
    en: { name: "Ahmedabad Jangid Mandal", description: "Gotra research and community gatherings in Gujarat.", address: "Ahmedabad, Gujarat" },
  },
  {
    slug: "yuva-jangid-manch-indore", type: "ORGANIZATION", location: "madhya-pradesh/indore/indore", year: 2015, phone: "9000000007",
    hi: { name: "युवा जांगिड़ मंच, इंदौर", description: "युवाओं के लिए खेल, रोजगार और नेतृत्व कार्यक्रम।", address: "इंदौर, मध्य प्रदेश" },
    en: { name: "Yuva Jangid Manch, Indore", description: "Sports, jobs and leadership programs for youth.", address: "Indore, Madhya Pradesh" },
  },
  {
    slug: "jaipur-parichay-sammelan-samiti", type: "COMMITTEE", location: "rajasthan/jaipur/jaipur", verified: true, phone: "9000000008",
    hi: { name: "जयपुर परिचय सम्मेलन समिति", description: "वार्षिक परिचय सम्मेलन की आयोजन समिति।", address: "जयपुर, राजस्थान" },
    en: { name: "Jaipur Introduction Conference Committee", description: "Organising committee of the annual introduction conference.", address: "Jaipur, Rajasthan" },
  },
  {
    slug: "haryana-mahila-samiti", type: "COMMITTEE", location: "haryana/karnal/karnal", phone: "9000000009",
    hi: { name: "हरियाणा महिला समिति", description: "महिला सशक्तिकरण और शिक्षा कार्यक्रम।", address: "करनाल, हरियाणा" },
    en: { name: "Haryana Mahila Samiti", description: "Women empowerment and education programs.", address: "Karnal, Haryana" },
  },
  {
    slug: "agra-samaj-karyakarini", type: "COMMITTEE", location: "uttar-pradesh/agra/agra",
    hi: { name: "आगरा समाज कार्यकारिणी", description: "उत्तर प्रदेश इकाई की कार्यकारिणी।", address: "आगरा, उत्तर प्रदेश" },
    en: { name: "Agra Samaj Executive Committee", description: "Executive committee of the Uttar Pradesh unit.", address: "Agra, Uttar Pradesh" },
  },
  {
    slug: "rohtak-blood-helpline", type: "CONTACT", location: "haryana/rohtak/rohtak", phone: "9000000010", publicContact: true,
    hi: { name: "आपातकालीन रक्तदान सहायता", description: "रक्त की जरूरत पर समाज के स्वयंसेवकों से संपर्क।", address: "रोहतक, हरियाणा" },
    en: { name: "Emergency Blood Donation Helpline", description: "Reach community volunteers when blood is needed.", address: "Rohtak, Haryana" },
  },
  {
    slug: "surat-samaj-bhawan", type: "SAMAJ_BHAWAN", location: "gujarat/surat/surat", phone: "9000000011", pincode: "395003",
    hi: { name: "जांगिड़ समाज भवन, सूरत", description: "व्यापार मेले व सामाजिक आयोजन।", address: "सूरत, गुजरात" },
    en: { name: "Jangid Samaj Bhawan, Surat", description: "Business fairs and community events.", address: "Surat, Gujarat" },
  },
  {
    slug: "bhopal-samaj-samiti", type: "COMMITTEE", location: "madhya-pradesh/bhopal/bhopal",
    hi: { name: "भोपाल समाज समिति", description: "सामूहिक विवाह और कल्याण कार्यक्रम।", address: "भोपाल, मध्य प्रदेश" },
    en: { name: "Bhopal Samaj Samiti", description: "Community weddings and welfare programs.", address: "Bhopal, Madhya Pradesh" },
  },
];

interface LeaderSeed {
  slug: string;
  category: "SARPANCH" | "ELECTED_REPRESENTATIVE" | "SOCIAL_WORKER" | "PRESIDENT" | "COMMITTEE_MEMBER" | "OTHER";
  location: string;
  org?: string;
  verified?: boolean;
  termStart?: string;
  termEnd?: string;
  order?: number;
  hi: { name: string; designation: string; bio: string };
  en: { name: string; designation: string; bio: string };
}

const leaders: LeaderSeed[] = [
  {
    slug: "ramesh-jangid", category: "PRESIDENT", location: "delhi/new-delhi/new-delhi", org: "akhil-bharatiya-jangid-samaj-mahasabha", verified: true, termStart: "2024-04-01", termEnd: "2027-03-31", order: 1,
    hi: { name: "रमेश जांगिड़", designation: "राष्ट्रीय अध्यक्ष, अखिल भारतीय जांगिड़ समाज महासभा", bio: "समाज के डिजिटल सदस्यता अभियान के प्रणेता।" },
    en: { name: "Ramesh Jangid", designation: "National President, Akhil Bharatiya Jangid Samaj Mahasabha", bio: "Champion of the samaj's digital membership drive." },
  },
  {
    slug: "sunita-jangid", category: "SARPANCH", location: "rajasthan/jaipur/jaipur/sanganer/dhani-jangidan", verified: true, termStart: "2020-01-26", termEnd: "2026-01-25", order: 2,
    hi: { name: "सुनीता जांगिड़", designation: "सरपंच, ग्राम पंचायत ढाणी जांगिडान", bio: "पेयजल और बालिका शिक्षा पर विशेष कार्य।" },
    en: { name: "Sunita Jangid", designation: "Sarpanch, Gram Panchayat Dhani Jangidan", bio: "Focused on drinking water and girls' education." },
  },
  {
    slug: "mahesh-jangid", category: "PRESIDENT", location: "rajasthan/jaipur/jaipur", org: "rajasthan-jangid-sabha", verified: true, termStart: "2023-06-01", order: 3,
    hi: { name: "महेश जांगिड़", designation: "अध्यक्ष, राजस्थान जांगिड़ सभा", bio: "राजस्थान में परिचय सम्मेलनों के संयोजक।" },
    en: { name: "Mahesh Jangid", designation: "President, Rajasthan Jangid Sabha", bio: "Convener of the introduction conferences in Rajasthan." },
  },
  {
    slug: "kavita-jangid", category: "SOCIAL_WORKER", location: "haryana/rohtak/rohtak", verified: true, order: 4,
    hi: { name: "कविता जांगिड़", designation: "सामाजिक कार्यकर्ता, रोहतक", bio: "रक्तदान शिविरों का नेतृत्व।" },
    en: { name: "Kavita Jangid", designation: "Social worker, Rohtak", bio: "Leads the blood donation camps." },
  },
  {
    slug: "dinesh-jangid", category: "ELECTED_REPRESENTATIVE", location: "gujarat/surat/surat", termStart: "2021-03-01", termEnd: "2026-02-28", order: 5,
    hi: { name: "दिनेश जांगिड़", designation: "पार्षद, नगर निगम सूरत", bio: "व्यापारी समुदाय के मुद्दों के प्रतिनिधि।" },
    en: { name: "Dinesh Jangid", designation: "Councillor, Surat Municipal Corporation", bio: "Represents traders' concerns." },
  },
  {
    slug: "pooja-jangid", category: "COMMITTEE_MEMBER", location: "haryana/karnal/karnal", org: "haryana-mahila-samiti", order: 6,
    hi: { name: "पूजा जांगिड़", designation: "सचिव, हरियाणा महिला समिति", bio: "महिला शिक्षा कार्यक्रम की संयोजक।" },
    en: { name: "Pooja Jangid", designation: "Secretary, Haryana Mahila Samiti", bio: "Coordinator of the women's education program." },
  },
  {
    slug: "anil-jangid", category: "SOCIAL_WORKER", location: "madhya-pradesh/indore/indore", org: "yuva-jangid-manch-indore", order: 7,
    hi: { name: "अनिल जांगिड़", designation: "संयोजक, युवा जांगिड़ मंच इंदौर", bio: "खेल महोत्सव के आयोजक।" },
    en: { name: "Anil Jangid", designation: "Convener, Yuva Jangid Manch Indore", bio: "Organiser of the sports festival." },
  },
  {
    slug: "meena-jangid", category: "OTHER", location: "uttar-pradesh/agra/agra", org: "agra-samaj-karyakarini", order: 8,
    hi: { name: "मीना जांगिड़", designation: "उपाध्यक्ष, आगरा समाज कार्यकारिणी", bio: "नई कार्यकारिणी की सदस्य।" },
    en: { name: "Meena Jangid", designation: "Vice President, Agra Samaj Executive Committee", bio: "Member of the new executive committee." },
  },
];

// ---- events -------------------------------------------------------------------
// Dates are relative to "now" so the demo always has upcoming AND past events.

const daysFromNow = (d: number, hourIst = 10) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + d);
  t.setUTCHours(hourIst - 6, 30, 0, 0); // IST = UTC+5:30
  return t.toISOString();
};

interface EventSeed {
  slug: string;
  category: "MEETING" | "CONFERENCE" | "PARICHAY_SAMMELAN" | "CULTURAL" | "RELIGIOUS" | "BLOOD_DONATION" | "SOCIAL_SERVICE" | "EDUCATION" | "SPORTS" | "OTHER";
  location: string;
  startsAt: string;
  endsAt?: string;
  image: string;
  featured?: boolean;
  registration?: { capacity?: number; deadline?: string; fee?: number };
  organizer: { name: string; phone?: string };
  org?: string;
  hi: { title: string; summary: string; description: string; venue: string; address: string };
  en: { title: string; summary: string; description: string; venue: string; address: string };
}

const events: EventSeed[] = [
  {
    slug: "jaipur-parichay-sammelan-2026",
    category: "PARICHAY_SAMMELAN",
    location: "rajasthan/jaipur/jaipur",
    startsAt: daysFromNow(12, 10),
    endsAt: daysFromNow(13, 18),
    image: U("1519741497674-611481863552"),
    featured: true,
    registration: { capacity: 500, deadline: daysFromNow(10, 20), fee: 200 },
    organizer: { name: "जयपुर परिचय सम्मेलन समिति", phone: "9000000008" },
    org: "jaipur-parichay-sammelan-samiti",
    hi: {
      title: "जांगिड़ समाज वार्षिक परिचय सम्मेलन 2026",
      summary: "दो दिवसीय युवक-युवती परिचय सम्मेलन, सम्मान समारोह और सांस्कृतिक संध्या।",
      description: "<p>राजस्थान और आसपास के राज्यों से परिवार भाग लेंगे। पंजीकरण के बाद परिचय पुस्तिका में नाम जोड़ा जाएगा।</p><p>भोजन और ठहरने की व्यवस्था समिति द्वारा की जाएगी।</p>",
      venue: "जांगिड़ समाज भवन",
      address: "मानसरोवर, जयपुर",
    },
    en: {
      title: "Jangid Samaj Annual Parichay Sammelan 2026",
      summary: "Two-day introduction meet, felicitation ceremony and cultural evening.",
      description: "<p>Families from Rajasthan and neighbouring states will take part. Registered candidates are added to the introduction booklet.</p><p>Meals and stay are arranged by the committee.</p>",
      venue: "Jangid Samaj Bhawan",
      address: "Mansarovar, Jaipur",
    },
  },
  {
    slug: "rohtak-raktdaan-shivir",
    category: "BLOOD_DONATION",
    location: "haryana/rohtak/rohtak",
    startsAt: daysFromNow(5, 9),
    endsAt: daysFromNow(5, 15),
    image: U("1615461066841-6116e61058f4"),
    registration: { capacity: 150 },
    organizer: { name: "युवा जांगिड़ मंच, रोहतक" },
    hi: {
      title: "रक्तदान शिविर — रोहतक",
      summary: "समाज के युवाओं द्वारा रक्तदान शिविर। हर रक्तदाता को प्रमाण पत्र मिलेगा।",
      description: "<p>18 से 60 वर्ष के स्वस्थ व्यक्ति रक्तदान कर सकते हैं। कृपया पहचान पत्र साथ लाएं।</p>",
      venue: "सामुदायिक भवन",
      address: "सेक्टर 3, रोहतक",
    },
    en: {
      title: "Blood Donation Camp — Rohtak",
      summary: "A blood donation camp run by the samaj youth. Every donor receives a certificate.",
      description: "<p>Healthy adults aged 18 to 60 can donate. Please carry an ID card.</p>",
      venue: "Community Hall",
      address: "Sector 3, Rohtak",
    },
  },
  {
    slug: "vishwakarma-jayanti-mahotsav",
    category: "RELIGIOUS",
    location: "gujarat/ahmedabad/ahmedabad",
    startsAt: daysFromNow(25, 8),
    image: U("1514222134-b57cbb8ce073"),
    featured: true,
    organizer: { name: "जांगिड़ समाज अहमदाबाद" },
    hi: {
      title: "भगवान विश्वकर्मा जयंती महोत्सव",
      summary: "शोभा यात्रा, हवन, भजन संध्या और प्रसाद वितरण।",
      description: "<p>सुबह 8 बजे शोभा यात्रा के साथ कार्यक्रम शुरू होगा। शाम को भजन संध्या होगी।</p>",
      venue: "विश्वकर्मा मंदिर",
      address: "मणिनगर, अहमदाबाद",
    },
    en: {
      title: "Bhagwan Vishwakarma Jayanti Mahotsav",
      summary: "Procession, havan, bhajan evening and prasad.",
      description: "<p>The programme starts with a procession at 8 am. A bhajan evening follows at dusk.</p>",
      venue: "Vishwakarma Temple",
      address: "Maninagar, Ahmedabad",
    },
  },
  {
    slug: "indore-khel-mahotsav",
    category: "SPORTS",
    location: "madhya-pradesh/indore/indore",
    startsAt: daysFromNow(-20, 9),
    endsAt: daysFromNow(-19, 18),
    image: U("1461896836934-ffe607ba8211"),
    organizer: { name: "युवा जांगिड़ मंच इंदौर" },
    org: "yuva-jangid-manch-indore",
    hi: {
      title: "जांगिड़ युवा खेल महोत्सव",
      summary: "क्रिकेट, कबड्डी और दौड़ प्रतियोगिताएं।",
      description: "<p>प्रदेश भर से 24 टीमों ने भाग लिया।</p>",
      venue: "नेहरू स्टेडियम",
      address: "इंदौर",
    },
    en: {
      title: "Jangid Youth Sports Festival",
      summary: "Cricket, kabaddi and athletics.",
      description: "<p>24 teams from across the state took part.</p>",
      venue: "Nehru Stadium",
      address: "Indore",
    },
  },
];

// ---- business directory -----------------------------------------------------------

/** [slug, nameHi, nameEn, lucide icon] */
const businessCategories: [string, string, string, string][] = [
  ["furniture", "फर्नीचर व लकड़ी", "Furniture & Woodwork", "armchair"],
  ["construction", "निर्माण व ठेकेदारी", "Construction & Contracting", "hard-hat"],
  ["interior", "इंटीरियर डिज़ाइन", "Interior Design", "sofa"],
  ["hardware", "हार्डवेयर व बिल्डिंग मटीरियल", "Hardware & Building Material", "wrench"],
  ["handicraft", "हस्तशिल्प", "Handicrafts", "palette"],
  ["retail", "दुकान व रिटेल", "Shops & Retail", "store"],
  ["education", "शिक्षा व कोचिंग", "Education & Coaching", "graduation-cap"],
  ["health", "स्वास्थ्य व क्लिनिक", "Health & Clinics", "stethoscope"],
  ["professional", "प्रोफेशनल सेवाएं", "Professional Services", "briefcase"],
  ["other", "अन्य", "Other", "sparkles"],
];

interface BusinessSeed {
  slug: string;
  category: string;
  location: string;
  image?: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  year?: number;
  verified?: boolean;
  featured?: boolean;
  hi: { name: string; tagline: string; description: string; address: string; offers?: string };
  en: { name: string; tagline: string; description: string; address: string; offers?: string };
}

const businesses: BusinessSeed[] = [
  {
    slug: "shree-vishwakarma-furniture-jaipur",
    category: "furniture",
    location: "rajasthan/jaipur/jaipur",
    image: U("1555041469-a586c61ea9bc"),
    phone: "9000000011",
    whatsapp: "9000000011",
    year: 1998,
    verified: true,
    featured: true,
    hi: {
      name: "श्री विश्वकर्मा फर्नीचर",
      tagline: "सागवान और शीशम का हस्तनिर्मित फर्नीचर",
      description: "तीन पीढ़ियों से जयपुर में कस्टम फर्नीचर। घर, ऑफिस और मंदिर के लिए ऑर्डर पर निर्माण।",
      address: "झोटवाड़ा औद्योगिक क्षेत्र, जयपुर",
      offers: "समाज सदस्यों के लिए 10% छूट",
    },
    en: {
      name: "Shree Vishwakarma Furniture",
      tagline: "Handcrafted teak and sheesham furniture",
      description: "Custom furniture in Jaipur for three generations. Made to order for homes, offices and temples.",
      address: "Jhotwara Industrial Area, Jaipur",
      offers: "10% off for samaj members",
    },
  },
  {
    slug: "jangid-interiors-ahmedabad",
    category: "interior",
    location: "gujarat/ahmedabad/ahmedabad",
    image: U("1618221195710-dd6b41faaea6"),
    phone: "9000000012",
    website: "https://example.com",
    year: 2012,
    verified: true,
    hi: {
      name: "जांगिड़ इंटीरियर्स",
      tagline: "मॉड्यूलर किचन और होम इंटीरियर",
      description: "डिज़ाइन से इंस्टॉलेशन तक पूरा काम, 5 साल की वारंटी के साथ।",
      address: "सैटेलाइट, अहमदाबाद",
    },
    en: {
      name: "Jangid Interiors",
      tagline: "Modular kitchens and home interiors",
      description: "End-to-end design and installation with a 5-year warranty.",
      address: "Satellite, Ahmedabad",
    },
  },
  {
    slug: "shiv-hardware-rohtak",
    category: "hardware",
    location: "haryana/rohtak/rohtak",
    image: U("1581783898377-1c85bf937427"),
    phone: "9000000013",
    year: 2005,
    hi: {
      name: "शिव हार्डवेयर एंड टूल्स",
      tagline: "कारपेंट्री टूल्स और फिटिंग्स",
      description: "कारीगरों के लिए सभी ब्रांड के पावर टूल्स, हार्डवेयर और फिटिंग्स।",
      address: "रेलवे रोड, रोहतक",
    },
    en: {
      name: "Shiv Hardware & Tools",
      tagline: "Carpentry tools and fittings",
      description: "Power tools, hardware and fittings from every major brand for craftsmen.",
      address: "Railway Road, Rohtak",
    },
  },
  {
    slug: "vidya-coaching-sikar",
    category: "education",
    location: "rajasthan/sikar/sikar",
    image: U("1523050854058-8df90110c9f1"),
    phone: "9000000014",
    year: 2016,
    verified: true,
    hi: {
      name: "विद्या कोचिंग सेंटर",
      tagline: "NEET, JEE और बोर्ड परीक्षा की तैयारी",
      description: "अनुभवी शिक्षक, छोटे बैच और समाज के मेधावी छात्रों के लिए छात्रवृत्ति।",
      address: "पिपराली रोड, सीकर",
      offers: "समाज के छात्रों को फीस में 20% छूट",
    },
    en: {
      name: "Vidya Coaching Centre",
      tagline: "NEET, JEE and board exam preparation",
      description: "Experienced teachers, small batches and scholarships for meritorious samaj students.",
      address: "Piprali Road, Sikar",
      offers: "20% fee concession for samaj students",
    },
  },
];

interface AchievementSeed {
  slug: string;
  category: "STUDENT" | "PROFESSIONAL" | "ENTREPRENEUR" | "SPORTS" | "SOCIAL" | "OTHER";
  location: string;
  image?: string;
  on: string;
  featured?: boolean;
  hi: { personName: string; title: string; description: string };
  en: { personName: string; title: string; description: string };
}

const achievements: AchievementSeed[] = [
  {
    slug: "kavya-jangid-upsc-air-84", category: "STUDENT", location: "rajasthan/jaipur/jaipur", image: U("1503428593586-e225b39bddfe"), on: "2026-05-14", featured: true,
    hi: { personName: "काव्या जांगिड़", title: "यूपीएससी सिविल सेवा परीक्षा में अखिल भारतीय रैंक 84", description: "जयपुर की काव्या ने तीसरे प्रयास में यह सफलता पाई। उन्होंने समाज की बेटियों के लिए निःशुल्क मार्गदर्शन का वादा किया है।" },
    en: { personName: "Kavya Jangid", title: "All India Rank 84 in the UPSC Civil Services Examination", description: "Kavya from Jaipur cleared the exam in her third attempt and has promised free guidance for the community's daughters." },
  },
  {
    slug: "rohit-jangid-national-wrestling-gold", category: "SPORTS", location: "haryana/rohtak/rohtak", image: U("1529156069898-49953e39b3ac"), on: "2026-03-02", featured: true,
    hi: { personName: "रोहित जांगिड़", title: "राष्ट्रीय कुश्ती चैंपियनशिप में स्वर्ण पदक", description: "रोहतक के रोहित ने 74 किलो वर्ग में स्वर्ण जीतकर हरियाणा का नाम रोशन किया।" },
    en: { personName: "Rohit Jangid", title: "Gold medal at the National Wrestling Championship", description: "Rohit from Rohtak won gold in the 74 kg category, making Haryana proud." },
  },
  {
    slug: "meena-jangid-furniture-export-award", category: "ENTREPRENEUR", location: "rajasthan/jodhpur/jodhpur", image: U("1556761175-5973dc0f32e7"), on: "2026-01-20",
    hi: { personName: "मीना जांगिड़", title: "हस्तशिल्प फर्नीचर निर्यात के लिए राज्य स्तरीय पुरस्कार", description: "जोधपुर में 40 कारीगर परिवारों को रोज़गार देने वाली मीना की इकाई अब 12 देशों में निर्यात करती है।" },
    en: { personName: "Meena Jangid", title: "State award for handicraft furniture exports", description: "Meena's unit in Jodhpur employs 40 artisan families and now exports to 12 countries." },
  },
  {
    slug: "dr-anil-jangid-rural-health-camps", category: "SOCIAL", location: "madhya-pradesh/indore/indore", image: U("1469571486292-0ba58a3f068b"), on: "2025-12-10",
    hi: { personName: "डॉ. अनिल जांगिड़", title: "ग्रामीण क्षेत्रों में 100 निःशुल्क स्वास्थ्य शिविर पूरे", description: "इंदौर के डॉ. अनिल ने पाँच वर्षों में 100 शिविर लगाकर 25,000 से अधिक ग्रामीणों की जाँच की।" },
    en: { personName: "Dr. Anil Jangid", title: "Completed 100 free rural health camps", description: "Dr. Anil of Indore ran 100 camps in five years, screening more than 25,000 villagers." },
  },
  {
    slug: "pooja-jangid-isro-scientist", category: "PROFESSIONAL", location: "delhi/new-delhi/new-delhi", image: U("1477587458883-47145ed94245"), on: "2026-02-18",
    hi: { personName: "पूजा जांगिड़", title: "इसरो में वैज्ञानिक के रूप में चयन", description: "दिल्ली की पूजा अब उपग्रह नियंत्रण प्रणाली पर काम करेंगी।" },
    en: { personName: "Pooja Jangid", title: "Selected as a scientist at ISRO", description: "Pooja from Delhi will now work on satellite control systems." },
  },
];

// Demo notices are clearly fictional and carry no photos (a real person's face must never be used on a death notice).
interface ObituarySeed {
  slug: string;
  gender: "MALE" | "FEMALE";
  location: string;
  /** Days before the seed run. */
  diedDaysAgo: number;
  born?: string;
  age?: number;
  gotraKey?: string;
  contact?: { name: string; relation: string; phone: string; isPublic: boolean };
  /** [type, days from the seed run, hour, venue, address?] */
  ceremonies: ["ANTIM_YATRA" | "UTHAVNA" | "SHOK_SABHA" | "PAGDI_RASM", number, number, string, string?][];
  hi: { name: string; relationLine?: string; nativePlace?: string; biography?: string; familyMessage?: string };
  en: { name: string; relationLine?: string; nativePlace?: string; biography?: string; familyMessage?: string };
}

const obituaries: ObituarySeed[] = [
  {
    slug: "shri-ramnarayan-jangid-jaipur", gender: "MALE", location: "rajasthan/jaipur/jaipur", diedDaysAgo: 2, born: "1948-03-12", gotraKey: "koolwal",
    contact: { name: "सुरेश जांगिड़", relation: "पुत्र", phone: "9829000001", isPublic: true },
    ceremonies: [["UTHAVNA", 2, 16, "जांगिड़ समाज भवन, मानसरोवर", "सेक्टर 5, मानसरोवर, जयपुर"], ["PAGDI_RASM", 10, 11, "निवास स्थान", "45, शांति नगर, जयपुर"]],
    hi: { name: "रामनारायण जांगिड़", relationLine: "पुत्र स्व. श्री मोतीलाल जांगिड़", nativePlace: "ग्राम बगरू, जयपुर", biography: "सेवानिवृत्त शिक्षक। चालीस वर्षों तक गाँव के विद्यालय में पढ़ाया और समाज के कई बच्चों को निःशुल्क शिक्षा दी।", familyMessage: "शोकाकुल: धर्मपत्नी श्रीमती कमला देवी, पुत्र सुरेश व महेश, पौत्र-पौत्रियाँ एवं समस्त जांगिड़ परिवार।" },
    en: { name: "Ramnarayan Jangid", relationLine: "S/o Late Shri Motilal Jangid", nativePlace: "Bagru village, Jaipur", biography: "A retired teacher who taught at the village school for forty years and educated many children of the community free of cost.", familyMessage: "Mourned by his wife Smt. Kamla Devi, sons Suresh and Mahesh, grandchildren and the entire Jangid family." },
  },
  {
    slug: "smt-sharda-devi-jangid-jodhpur", gender: "FEMALE", location: "rajasthan/jodhpur/jodhpur", diedDaysAgo: 6, age: 81,
    ceremonies: [["SHOK_SABHA", 1, 15, "विश्वकर्मा मंदिर प्रांगण", "पावटा, जोधपुर"]],
    hi: { name: "शारदा देवी जांगिड़", relationLine: "धर्मपत्नी स्व. श्री भंवरलाल जांगिड़", nativePlace: "पीपाड़ शहर", familyMessage: "शोकाकुल: पुत्र राजेश, पुत्रवधू सुनीता एवं समस्त परिवारजन।" },
    en: { name: "Sharda Devi Jangid", relationLine: "W/o Late Shri Bhanwarlal Jangid", nativePlace: "Pipar City", familyMessage: "Mourned by her son Rajesh, daughter-in-law Sunita and the whole family." },
  },
  {
    slug: "shri-omprakash-jangid-rohtak", gender: "MALE", location: "haryana/rohtak/rohtak", diedDaysAgo: 25, born: "1956-08-01", gotraKey: "ajmera",
    ceremonies: [["UTHAVNA", -21, 14, "सामुदायिक भवन", "मॉडल टाउन, रोहतक"]],
    hi: { name: "ओमप्रकाश जांगिड़", relationLine: "पुत्र स्व. श्री हरिराम जांगिड़", biography: "लकड़ी के कारीगर और रोहतक जांगिड़ सभा के पूर्व कोषाध्यक्ष।" },
    en: { name: "Omprakash Jangid", relationLine: "S/o Late Shri Hariram Jangid", biography: "A woodcraft artisan and former treasurer of the Rohtak Jangid Sabha." },
  },
];

interface JobSeed {
  slug: string;
  type: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP" | "FREELANCE" | "BUSINESS_OPPORTUNITY";
  workMode?: "ONSITE" | "REMOTE" | "HYBRID";
  organisation: string;
  business?: string;
  location: string;
  salary?: [number, number];
  experience?: number;
  vacancies?: number;
  /** Days from the seed run. */
  closesIn?: number;
  featured?: boolean;
  phone?: string;
  hi: { title: string; description: string; requirements?: string };
  en: { title: string; description: string; requirements?: string };
}

const jobs: JobSeed[] = [
  {
    slug: "furniture-karigar-jaipur", type: "FULL_TIME", organisation: "श्री विश्वकर्मा फर्नीचर", business: "shree-vishwakarma-furniture-jaipur", location: "rajasthan/jaipur/jaipur",
    salary: [18000, 28000], experience: 2, vacancies: 4, closesIn: 20, featured: true, phone: "9000000101",
    hi: { title: "अनुभवी फर्नीचर कारीगर की आवश्यकता", description: "हमारी जयपुर वर्कशॉप के लिए सागवान और शीशम के फर्नीचर बनाने वाले कारीगर चाहिए। रहने की व्यवस्था और समय पर वेतन।", requirements: "कम से कम 2 वर्ष का अनुभव, नक्काशी का ज्ञान हो तो प्राथमिकता।" },
    en: { title: "Experienced furniture craftsmen wanted", description: "We need craftsmen for teak and sheesham furniture at our Jaipur workshop. Accommodation provided and salary on time.", requirements: "At least 2 years of experience; carving skills preferred." },
  },
  {
    slug: "interior-designer-intern-indore", type: "INTERNSHIP", workMode: "HYBRID", organisation: "Jangid Interiors Studio", location: "madhya-pradesh/indore/indore",
    salary: [8000, 12000], vacancies: 2, closesIn: 30,
    hi: { title: "इंटीरियर डिज़ाइन इंटर्नशिप (6 माह)", description: "इंटीरियर डिज़ाइन के विद्यार्थियों के लिए साइट विज़िट, 3D मॉडलिंग और क्लाइंट मीटिंग का व्यावहारिक अनुभव।" },
    en: { title: "Interior design internship (6 months)", description: "Hands-on site visits, 3D modelling and client meetings for interior design students." },
  },
  {
    slug: "accountant-part-time-jodhpur", type: "PART_TIME", organisation: "जांगिड़ समाज सेवा समिति, जोधपुर", location: "rajasthan/jodhpur/jodhpur",
    salary: [10000, 12000], experience: 1, vacancies: 1, closesIn: 15,
    hi: { title: "पार्ट-टाइम लेखाकार", description: "समिति के खातों, रसीदों और वार्षिक रिपोर्ट के लिए शाम के समय 3 घंटे काम।", requirements: "टैली का ज्ञान आवश्यक।" },
    en: { title: "Part-time accountant", description: "Three hours every evening to manage the committee's accounts, receipts and annual report.", requirements: "Tally knowledge required." },
  },
  {
    slug: "modular-kitchen-dealership-gujarat", type: "BUSINESS_OPPORTUNITY", organisation: "WoodCraft Modular", location: "gujarat/ahmedabad/ahmedabad", closesIn: 45,
    hi: { title: "मॉड्यूलर किचन डीलरशिप — गुजरात के शहरों में", description: "समाज के युवा उद्यमियों के लिए कम निवेश में मॉड्यूलर किचन डीलरशिप। प्रशिक्षण और मार्केटिंग सहायता कंपनी देगी।" },
    en: { title: "Modular kitchen dealership — Gujarat cities", description: "A low-investment modular kitchen dealership for young samaj entrepreneurs, with training and marketing support from the company." },
  },
];

interface AlbumSeed {
  slug: string;
  location: string;
  event?: string;
  takenDaysAgo: number;
  featured?: boolean;
  photos: string[];
  hi: { title: string; description?: string };
  en: { title: string; description?: string };
}

const albums: AlbumSeed[] = [
  {
    slug: "vishwakarma-jayanti-2025-jaipur", location: "rajasthan/jaipur/jaipur", event: "vishwakarma-jayanti-mahotsav", takenDaysAgo: 40, featured: true,
    photos: [U("1548013146-72479768bada"), U("1524492412937-b28074a5d7da"), U("1514222134-b57cbb8ce073"), U("1477587458883-47145ed94245")],
    hi: { title: "विश्वकर्मा जयंती महोत्सव — झलकियां", description: "शोभायात्रा, पूजन और सम्मान समारोह की तस्वीरें।" },
    en: { title: "Vishwakarma Jayanti festival — highlights", description: "Photos from the procession, puja and felicitation ceremony." },
  },
  {
    slug: "pratibha-samman-samaroh-jodhpur", location: "rajasthan/jodhpur/jodhpur", takenDaysAgo: 75,
    photos: [U("1523050854058-8df90110c9f1"), U("1531482615713-2afd69097998"), U("1521737604893-d14cc237f11d")],
    hi: { title: "प्रतिभा सम्मान समारोह, जोधपुर", description: "10वीं और 12वीं के मेधावी विद्यार्थियों का सम्मान।" },
    en: { title: "Talent felicitation, Jodhpur", description: "Honouring the top students of classes 10 and 12." },
  },
];

interface MatrimonySeed {
  email: string;
  code: string;
  gender: "MALE" | "FEMALE";
  dob: string;
  height: number;
  location: string;
  gotraKey?: string;
  education: "GRADUATE" | "POST_GRADUATE" | "PROFESSIONAL" | "DIPLOMA";
  educationText: string;
  profession: string;
  income: "L3_TO_6L" | "L6_TO_10L" | "L10_TO_20L";
  name: string;
  father: string;
  about: string;
  verified?: boolean;
}

// Fictional profiles, no photos, phone numbers in the unused 90000 series.
const matrimony: MatrimonySeed[] = [
  { email: "demo.rahul@jangidsamaj.local", code: "JS10001", gender: "MALE", dob: "1996-04-12", height: 175, location: "rajasthan/jaipur/jaipur", gotraKey: "koolwal", education: "PROFESSIONAL", educationText: "B.Tech (Civil)", profession: "Site engineer", income: "L6_TO_10L", name: "Rahul Jangid", father: "Shri Mahesh Jangid", about: "Simple, family-oriented, enjoys woodwork and cricket.", verified: true },
  { email: "demo.amit@jangidsamaj.local", code: "JS10002", gender: "MALE", dob: "1994-11-02", height: 170, location: "haryana/rohtak/rohtak", gotraKey: "ajmera", education: "GRADUATE", educationText: "B.Com", profession: "Furniture business", income: "L10_TO_20L", name: "Amit Jangid", father: "Shri Ramesh Jangid", about: "Runs the family furniture business in Rohtak." },
  { email: "demo.priya@jangidsamaj.local", code: "JS10003", gender: "FEMALE", dob: "1998-07-21", height: 160, location: "rajasthan/jodhpur/jodhpur", gotraKey: "dhariwal", education: "POST_GRADUATE", educationText: "M.Sc (Chemistry)", profession: "School teacher", income: "L3_TO_6L", name: "Priya Jangid", father: "Shri Suresh Jangid", about: "Teacher, loves classical music and cooking.", verified: true },
  { email: "demo.neha@jangidsamaj.local", code: "JS10004", gender: "FEMALE", dob: "1997-01-30", height: 158, location: "delhi/new-delhi/new-delhi", education: "PROFESSIONAL", educationText: "CA", profession: "Chartered accountant", income: "L10_TO_20L", name: "Neha Jangid", father: "Shri Dinesh Jangid", about: "Working in Delhi; values family and honesty." },
];

export const demo = { locations, categories, tags, news, directory, leaders, events, businessCategories, businesses, achievements, obituaries, jobs, albums, matrimony };
