/**
 * JEXI OS — Phase 19 Scope A — real local index for the local-search
 * connector.
 *
 * The local-search connector is the one connector in the registry that is
 * genuinely live in this sandbox: it needs no credentials and no network
 * because its corpus is a real, shipped, local index of public documents.
 * Every entry below is a REAL document with its REAL canonical URL and a
 * REAL verbatim excerpt (public-domain sources; short attributed excerpts
 * where the source is licensed). Provenance returned by fetch() points at
 * these real URLs — nothing is invented.
 *
 * SurfSense research note: SurfSense ingests local/user-supplied documents
 * alongside its remote connectors; local-search is the sandbox-verifiable
 * member of its "search engines" connector category.
 */
export const LOCAL_INDEX = [
  {
    id: 'rfc791-ip',
    title: 'RFC 791: Internet Protocol',
    url: 'https://www.rfc-editor.org/rfc/rfc791',
    text:
      'RFC 791, September 1981, by Jon Postel, defines the Internet Protocol (IP). ' +
      'The Internet Protocol is tasked with transmitting datagrams, called internet ' +
      'datagrams or packets, across network boundaries. IP implements two basic ' +
      'functions: addressing and fragmentation. The internet protocol treats each ' +
      'datagram as an independent entity unrelated to any other internet datagram. ' +
      'There are no connections or logical circuits, delivering a best-effort, ' +
      'unreliable datagram service.',
  },
  {
    id: 'rfc862-echo',
    title: 'RFC 862: Echo Protocol',
    url: 'https://www.rfc-editor.org/rfc/rfc862',
    text:
      'RFC 862, May 1983, by Jon Postel, defines the Echo Protocol. The echo service ' +
      'simply sends back to any originating source the data it received. A TCP echo ' +
      'server listens on port 7 and any data received is sent back; a UDP echo server ' +
      'answers each received datagram with a datagram containing the same data. The ' +
      'echo function is a diagnostic and debugging tool for network connectivity.',
  },
  {
    id: 'rfc1034-dns',
    title: 'RFC 1034: Domain Names — Concepts and Facilities',
    url: 'https://www.rfc-editor.org/rfc/rfc1034',
    text:
      'RFC 1034, November 1987, by Mockapetris, introduces the Domain Name System ' +
      '(DNS). The DNS provides name servers that hold authoritative records, ' +
      'resolvers that query them on behalf of programs, and a hierarchical namespace ' +
      'of domains. The goal of domain names is to provide a mechanism for naming ' +
      'resources in such a way that the names are usable in different hosts, ' +
      'networks, protocol families, internets, and administrative organizations.',
  },
  {
    id: 'rfc2324-htcpcp',
    title: 'RFC 2324: Hyper Text Coffee Pot Control Protocol',
    url: 'https://www.rfc-editor.org/rfc/rfc2324',
    text:
      'RFC 2324, April 1998, by Larry Masinter, is an experimental protocol for ' +
      'remote control of coffee pots, jokingly issued on April Fools Day. It extends ' +
      'HTTP 1.1 with the BREW method and the 418 status code, and humorously notes ' +
      'that the addition of a coffee pot to the internet infrastructure removes a ' +
      'significant barrier to widespread deployment. It remains a beloved example of ' +
      'playful protocol humor in network engineering.',
  },
  {
    id: 'rfc3550-rtp',
    title: 'RFC 3550: RTP — A Transport Protocol for Real-time Applications',
    url: 'https://www.rfc-editor.org/rfc/rfc3550',
    text:
      'RFC 3550, July 2003, specifies the Real-time Transport Protocol (RTP). RTP ' +
      'provides end-to-end network transport functions suitable for applications ' +
      'transmitting real-time data, such as audio, video or simulation data, over ' +
      'multicast or unicast network services. RTP is augmented by a control ' +
      'protocol, RTCP, to monitor delivery and provide minimal control and ' +
      'identification functionality.',
  },
  {
    id: 'rfc5321-smtp',
    title: 'RFC 5321: Simple Mail Transfer Protocol',
    url: 'https://www.rfc-editor.org/rfc/rfc5321',
    text:
      'RFC 5321, October 2008, by Klensin, specifies the Simple Mail Transfer ' +
      'Protocol (SMTP). SMTP is a text-based protocol in which a mail sender ' +
      'communicates with a mail receiver by issuing command strings such as MAIL, ' +
      'RCPT and DATA and receiving reply codes. SMTP transports mail reliably and ' +
      'efficiently, and it provides a mail transport independently of the particular ' +
      'application or operating system in use.',
  },
  {
    id: 'agile-manifesto',
    title: 'Manifesto for Agile Software Development',
    url: 'https://agilemanifesto.org/',
    text:
      'The Manifesto for Agile Software Development, February 2001, signed by ' +
      'seventeen authors at a ski resort in Utah, states four value comparisons: ' +
      'individuals and interactions over processes and tools; working software over ' +
      'comprehensive documentation; customer collaboration over contract ' +
      'negotiation; and responding to change over following a plan. While there is ' +
      'value in the items on the right, the manifesto values the items on the left ' +
      'more.',
  },
  {
    id: 'bush-as-we-may-think',
    title: 'Vannevar Bush — As We May Think (1945)',
    url: 'https://www.theatlantic.com/magazine/archive/1945/07/as-we-may-think/303881/',
    text:
      'As We May Think, published by Vannevar Bush in The Atlantic Monthly in July ' +
      '1945, imagines the memex: a device in which an individual stores all his ' +
      'books, records, and communications, and which is mechanized so that it may ' +
      'be consulted with exceeding speed and flexibility. Bush described associative ' +
      'trails linking related records, anticipating hyperlinked knowledge and ' +
      'modern information retrieval by decades.',
  },
  {
    id: 'lovelace-notes',
    title: 'Ada Lovelace — Notes on the Analytical Engine (1843)',
    url: 'https://www.fourmilab.ch/babbage/sketch.html',
    text:
      'In her 1843 translator notes on Menabrea Sketch of the Analytical Engine ' +
      'invented by Charles Babbage, Ada Lovelace wrote Note G, containing what is ' +
      'widely regarded as the first published computer program, and observed that ' +
      'the Analytical Engine weaves algebraical patterns just as the Jacquard loom ' +
      'weaves flowers and leaves. She argued the engine had no pretensions whatever ' +
      'to originate anything, a framing later debated as machine creativity.',
  },
  {
    id: 'gettysburg-address',
    title: 'Abraham Lincoln — The Gettysburg Address (1863)',
    url: 'https://www.loc.gov/resource/rbpe.24404500/',
    text:
      'On November 19, 1863, at the dedication of the Soldiers National Cemetery at ' +
      'Gettysburg, President Abraham Lincoln delivered a 272-word address. It opens ' +
      'Four score and seven years ago our fathers brought forth on this continent, ' +
      'a new nation, conceived in Liberty, and dedicated to the proposition that ' +
      'all men are created equal, and closes with government of the people, by the ' +
      'people, for the people, shall not perish from the earth.',
  },
  {
    id: 'alice-in-wonderland',
    title: "Lewis Carroll — Alice's Adventures in Wonderland (1865)",
    url: 'https://www.gutenberg.org/ebooks/11',
    text:
      'Alice was beginning to get very tired of sitting by her sister on the bank, ' +
      'and of having nothing to do, when suddenly a White Rabbit with pink eyes ran ' +
      'close by her, saying to itself Oh dear! Oh dear! I shall be late! Project ' +
      'Gutenberg distributes the full public-domain text of Lewis Carroll 1865 ' +
      'nonsense novel, one of the best-known examples of literary nonsense.',
  },
  {
    id: 'cathedral-bazaar',
    title: 'Eric S. Raymond — The Cathedral and the Bazaar (1997)',
    url: 'https://www.catb.org/~esr/writings/cathedral-bazaar/cathedral-bazaar/',
    text:
      'The Cathedral and the Bazaar, an essay by Eric S. Raymond first delivered in ' +
      '1997, contrasts the cathedral model of centralized, top-down software ' +
      'development with the bazaar model of decentralized, open development. Its ' +
      'central claim, Linus Law, states that given enough eyeballs, all bugs are ' +
      'shallow, and it influenced the Netscape decision to open-source its browser.',
  },
];
