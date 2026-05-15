import type { FetchedDocument } from '../types';

const seedMetadata = (id: string) => ({ seed: true, scaffoldId: id });

export const fetchStaticDocs = async (): Promise<FetchedDocument[]> => [
  {
    identifier: 'static:logos-overview',
    sourceType: 'static_seed',
    title: 'Logos Project Overview',
    url: 'https://logos.co',
    sectionPath: 'Overview > Project',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('logos-overview'),
    content:
      'Logos is an open-source ecosystem of privacy-preserving network protocols and applications maintained by Logos contributors and built around censorship-resistant infrastructure. The stack spans a base-layer blockchain (the Logos Blockchain with the Cryptarchia consensus and the Logos Execution Zone for smart contracts), peer-to-peer messaging (Waku), an anonymous-routing layer (Nomos and the Blend network), and a developer surface for building user-facing applications (Logos Modules, Builder Hub, and supporting SDKs). The goal is to give individuals and communities sovereignty over money, communication, and computation without depending on centralized intermediaries. Builders extending Logos typically interact with three concerns: protocol specifications captured as Logos Improvement Proposals (LIPs) and specs, node and operator tooling for running validators and relays, and application-layer SDKs and modules that consume the protocols. Documentation is fragmented across logos.co, build.logos.co, docs.waku.org, press.logos.co, blog.nomos.tech, and the logos-co and logos-blockchain GitHub organizations. When a question is about a specific product, check the relevant overview document below (Logos Blockchain Node, Logos Execution Zone, Waku, Nomos, LIPs, Cryptarchia, or Logos Modules) and then drill into the corresponding repository or docs site for implementation details.',
  },
  {
    identifier: 'static:logos-blockchain-node',
    sourceType: 'static_seed',
    title: 'Logos Blockchain Node Overview',
    url: 'https://build.logos.co/node',
    sectionPath: 'Logos Blockchain > Node operations',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('logos-blockchain-node'),
    content:
      'The Logos Blockchain Node is the reference client that participates in the Logos Blockchain network, validates blocks under the Cryptarchia consensus, gossips transactions, and exposes RPC endpoints used by wallets, the Logos Execution Zone, and observability tooling. Operators run a node when they want to validate, host application backends, or contribute network capacity. A typical node lifecycle covers four stages. First, prerequisites: a supported Linux or macOS host, a recent Rust toolchain or pre-built binary, an open peer-to-peer port, persistent disk for chain state, and access to bootstrap peers. Second, configuration: generate or import a node key, choose a network (mainnet or a public testnet), set data directories, and tune logging and metrics. Third, startup: launch the node binary or systemd service, watch the sync progress, peer count, and disk usage, and verify RPC responses. Fourth, operations: monitor logs and Prometheus metrics, schedule backups of the keystore and DB, apply software upgrades, and react to consensus or networking alerts. Authoritative how-to material lives in logos-co/logos-docs (quickstart guides), logos-blockchain/logos-blockchain (CONTRIBUTING and systemd recipes), and logos-blockchain/logos-blockchain-testing (the operator book with prerequisites, quickstart, runners, node control, and operations sections).',
  },
  {
    identifier: 'static:logos-execution-zone',
    sourceType: 'static_seed',
    title: 'Logos Execution Zone (LEZ) Overview',
    url: 'https://build.logos.co/lez',
    sectionPath: 'Logos Blockchain > Logos Execution Zone',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('logos-execution-zone'),
    content:
      'The Logos Execution Zone (LEZ) is the smart-contract execution environment hosted on top of the Logos Blockchain settlement layer. It targets developers who want programmable assets, custom tokens, and on-chain applications while inheriting the privacy and decentralization properties of the underlying Logos stack. The LEZ exposes a wallet for end users, a program-deployment toolchain for developers, and tutorials covering token-transfer, associated token accounts (ATAs), automated market makers (AMM), and custom tokens. Builders typically follow this path: install or launch the LEZ wallet, fund a testnet account, scaffold a new program with the deployment tooling, write and test the program, deploy it to the active testnet, and exercise it from the wallet or RPC. The reference repository is logos-blockchain/logos-execution-zone, which carries the LEZ testnet v0.1 tutorial set under docs/, the program_deployment example under examples/, and bedrock/all-in-one configurations for local integration runs. End-user wallet onboarding is documented in logos-co/logos-docs under docs/apps/wallet/journeys. The LEZ is distinct from the base-layer node (see Logos Blockchain Node Overview): the node provides settlement and consensus, the LEZ provides programmability on top.',
  },
  {
    identifier: 'static:logos-waku',
    sourceType: 'static_seed',
    title: 'Waku Messaging Overview',
    url: 'https://docs.waku.org',
    sectionPath: 'Logos Stack > Waku',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('logos-waku'),
    content:
      'Waku is the privacy-preserving peer-to-peer messaging layer used across the Logos ecosystem and other privacy-focused projects. It provides decentralized, topic-based publish-subscribe messaging with store-and-forward behavior for offline peers, light-client support for resource-constrained devices, and resistance to centralized infrastructure dependencies. Applications use Waku when they need encrypted communication channels, on-chain notifications, mixnet relays, or any messaging primitive that should survive without operator-controlled servers. There are two integration paths. The first is running a full Waku node (nwaku): operators follow the Waku documentation under run-node/ to install prerequisites, build nwaku from source or pull a binary, choose between relay, store, filter, and lightpush roles, configure peers and discovery, and expose the JSON-RPC or REST API. The second is consuming Waku from a JavaScript or Go application: developers use the @waku/sdk library to instantiate a light or full node inside the application, subscribe to content topics, publish messages, configure discovery, and bridge messages to the rest of their stack. Reference material lives at docs.waku.org (run-node, build/javascript, learn, and incentivisation sections) and in logos-co GitHub repositories that wrap Waku for specific products such as the AnonComms mixnet and Status integrations.',
  },
  {
    identifier: 'static:nomos',
    sourceType: 'static_seed',
    title: 'Nomos Privacy Stack Overview',
    url: 'https://blog.nomos.tech',
    sectionPath: 'Logos Stack > Nomos',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('nomos'),
    content:
      'Nomos is the privacy-preserving network protocol research initiative inside the Logos ecosystem. It explores how to build a sovereign, censorship-resistant network whose users keep transactional, communication, and computational privacy without centralized trust. Nomos research drives the protocol families that the Logos Blockchain and Waku adopt over time, including Cryptarchia (private proof-of-stake consensus), the Blend network (anonymous mixing and message encapsulation), NomosDA (data availability with KZG commitments), Bedrock services (zone coordination and validation), and zero-knowledge tooling for execution zones. Outputs land in three places. First, peer-reviewed-style write-ups on blog.nomos.tech that compare design choices against Bitcoin, Ethereum, Ouroboros, GHOST, and similar work and explain why Nomos selects a given approach. Second, normative specifications and improvement proposals captured under logos-co/logos-lips and logos-blockchain/logos-blockchain-specs, often prefixed with NOMOS- (for example NOMOS-CRYPTARCHIA-V1-PROTOCOL, NOMOS-BLEND-PROTOCOL, NOMOS-DA-NETWORK, NOMOS-MESSAGE-ENCAPSULATION, NOMOS-KEY-TYPES-GENERATION). Third, simulator and testbed code under logos-blockchain/logos-blockchain-simulations and adjacent repositories. Questions about consensus theory, network privacy, mixnet design, or DA architecture typically map to a Nomos blog post plus a NOMOS- spec; runtime questions map to the Logos Blockchain Node or LEZ stack.',
  },
  {
    identifier: 'static:logos-improvement-proposals',
    sourceType: 'static_seed',
    title: 'Logos Improvement Proposals (LIPs)',
    url: 'https://github.com/logos-co/logos-lips',
    sectionPath: 'Governance > Logos Improvement Proposals',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('logos-improvement-proposals'),
    content:
      'Logos Improvement Proposals (LIPs) are the open, versioned process used to describe, discuss, and track proposed changes to Logos protocols, standards, and ecosystem specifications. The LIP index lives in logos-co/logos-lips and is mirrored across related logos-blockchain repositories when a proposal becomes a normative specification. A LIP captures the motivation for a change, the technical design (often with pseudo-code, diagrams, or formal definitions), backwards-compatibility impact, security considerations, prior art, and implementation status. Proposals progress through draft, review, last-call, accepted, and final stages, and any participant can comment via the GitHub repository. LIPs span the entire stack: consensus (Cryptarchia variants), data availability (NOMOS-DA), anonymous messaging (Blend, RLN deployment), key types and cryptographic primitives, RPC and node behavior, and application standards such as token formats. When a builder needs the authoritative behavior of a Logos component, the LIP for that component is the source of truth and supersedes blog posts or quickstart guides where they conflict. Specifications inside logos-blockchain/logos-blockchain-specs play the same role for blockchain-specific protocols and are similarly versioned and indexed.',
  },
  {
    identifier: 'static:logos-cryptarchia',
    sourceType: 'static_seed',
    title: 'Cryptarchia Consensus Overview',
    url: 'https://logos.co/technology',
    sectionPath: 'Logos Blockchain > Cryptarchia',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('logos-cryptarchia'),
    content:
      'Cryptarchia is the consensus protocol family that secures the Logos Blockchain. It is a private proof-of-stake (private PoS) design that descends from the Ouroboros family (Ouroboros, Praos, Genesis) and Ouroboros Crypsinous, with adaptations for stronger leadership-election privacy, an explicit fork choice rule that is not GHOST, and incentive structures aligned with the broader Logos goal of resistant, decentralized infrastructure. The core idea is that validators are selected through a private lottery based on staked weight, so that block producers can sign blocks without leaking their identity to observers and so that adversaries cannot easily target the next leader. Cryptarchia coordinates network security, slot timing, block production, and fork choice while preserving operator privacy. Detailed treatment lives in NOMOS-CRYPTARCHIA-V1-PROTOCOL under logos-blockchain/logos-blockchain-specs and in companion blog posts on blog.nomos.tech that compare Cryptarchia against Bitcoin proof-of-work, Ethereum proof-of-stake, raw Ouroboros, and the GHOST fork choice rule, and that discuss lottery difficulty and validator incentives. Operators running a Logos node interact with Cryptarchia indirectly: the node software implements the protocol, and operators tune staking, key material, and uptime through the node configuration (see Logos Blockchain Node Overview).',
  },
  {
    identifier: 'static:logos-modules',
    sourceType: 'static_seed',
    title: 'Logos Modules and Application Tooling',
    url: 'https://github.com/logos-co/logos-module-builder',
    sectionPath: 'Logos Apps > Modules',
    language: 'en',
    remoteRevision: 'scaffold-v2',
    metadata: seedMetadata('logos-modules'),
    content:
      'Logos Modules are the application-layer building blocks for the Logos desktop and mobile clients. A module is a self-contained piece of application logic plus user interface that runs inside a Logos host shell, with controlled access to the underlying Logos stack (Waku messaging, key management, the Logos Blockchain RPC, the Logos Execution Zone wallet, and module-to-module messaging). Builders use modules to ship features like chat, storage UIs, dashboards, or domain-specific tools without forking the host application. The reference tooling spans several repositories. logos-co/logos-module-builder is the SDK and reference scaffold (see docs/getting-started.md). logos-co/logos-tutorial is the multi-part walk-through that covers wrapping a C library, building a QML UI, and building a process-isolated C++ UI module. logos-co/logos-dev-boost ships developer skills, including a Nix flake setup. logos-co/scaffold provides Program Deployment scaffolds, including the default template. logos-co/crossdeployqt is the Qt cross-deployment helper that packages modules across operating systems. logos-co/logos-storage-ui (and other UI repos) are example modules in their own right. When a question is about extending Logos applications, the relevant repository is one of these; when it is about the host shell or the underlying protocols, follow the pointers in the other scaffold documents.',
  },
];
