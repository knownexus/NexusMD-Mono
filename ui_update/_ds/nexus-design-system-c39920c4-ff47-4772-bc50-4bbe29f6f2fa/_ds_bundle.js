/* @ds-bundle: {"format":3,"namespace":"NexusDesignSystem_c39920","components":[],"sourceHashes":{"ui_kits/web/AdminBrandProfiles.jsx":"eb78ffbf1cc6","ui_kits/web/AdminRoles.jsx":"1a50c9b04cae","ui_kits/web/AdminUsers.jsx":"e855926f400f","ui_kits/web/Analytics.jsx":"9bd400c64811","ui_kits/web/Announcements.jsx":"f0bd74fd8776","ui_kits/web/AudienceTree.jsx":"6c8108858146","ui_kits/web/BrandSwitcher.jsx":"46489b4a0a1b","ui_kits/web/Characters.jsx":"09270614967f","ui_kits/web/Events.jsx":"5585f3e5a0b0","ui_kits/web/Forum.jsx":"58f93e2a1393","ui_kits/web/Home.jsx":"988d7e45fb1f","ui_kits/web/Login.jsx":"733c33d7e215","ui_kits/web/Modal.jsx":"b3183eb808fb","ui_kits/web/Placeholder.jsx":"5d8cb2688660","ui_kits/web/Sidebar.jsx":"3933845f9122","ui_kits/web/TagInput.jsx":"cb594a5a3e17","ui_kits/web/Wiki.jsx":"87629af74062","ui_kits/web/app.jsx":"5013c28e9f81","ui_kits/web/icons.jsx":"ea0ef660c204"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.NexusDesignSystem_c39920 = window.NexusDesignSystem_c39920 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// ui_kits/web/AdminBrandProfiles.jsx
try { (() => {
// Admin: Brand Profiles — gallery of brand profile cards that you can activate.
// Live-switches the kit's data-brand when "Activate" is clicked.
const LS_BRAND_KEY_2 = 'nexus-ui-kit-brand-v1';
const AdminBrandProfiles = ({
  onOpenModal
}) => {
  const [profiles, setProfiles] = React.useState([]);
  const [active, setActive] = React.useState(() => {
    try {
      return localStorage.getItem(LS_BRAND_KEY_2) || 'nexus-default-dark';
    } catch {
      return 'nexus-default-dark';
    }
  });
  React.useEffect(() => {
    fetch(window.__resources && window.__resources.brandManifest || '../../brand-profiles/manifest.json').then(r => r.json()).then(setProfiles).catch(() => setProfiles([]));
  }, []);
  const activate = id => {
    setActive(id);
    document.documentElement.dataset.brand = id;
    try {
      localStorage.setItem(LS_BRAND_KEY_2, id);
    } catch {}
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Brand Profiles"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: () => onOpenModal({
      kind: 'brand-new'
    })
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 14,
    style: {
      marginRight: 4
    }
  }), " New Profile"))), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-muted)',
      marginTop: '-1rem',
      marginBottom: '2rem',
      maxWidth: 640
    }
  }, "Themes, colours, fonts and terminology for this community. Activating a profile takes effect immediately \u2014 try it."), /*#__PURE__*/React.createElement("div", {
    className: "bp-grid"
  }, profiles.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    className: "bp-card" + (p.id === active ? " bp-card--active" : "")
  }, /*#__PURE__*/React.createElement("div", {
    className: "bp-card__swatches"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: p.page
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: p.card
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: p.accent
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: p.text
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: p.text
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "bp-card__body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bp-card__head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "bp-card__name"
  }, p.name), /*#__PURE__*/React.createElement("div", {
    className: "bp-card__community"
  }, p.communityName)), p.id === active && /*#__PURE__*/React.createElement("span", {
    className: "bp-card__active-badge"
  }, "Active")), /*#__PURE__*/React.createElement("p", {
    className: "bp-card__tag"
  }, "\"", p.tagline, "\""), /*#__PURE__*/React.createElement("div", {
    className: "bp-card__fonts"
  }, p.fonts.heading, " \xB7 ", p.fonts.body), /*#__PURE__*/React.createElement("div", {
    className: "bp-card__actions"
  }, p.id !== active && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-success btn-sm",
    onClick: () => activate(p.id)
  }, "Activate"), p.id === active && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-outline-secondary btn-sm",
    onClick: () => activate('nexus-default-dark')
  }, "Deactivate"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-outline-secondary btn-sm"
  }, "Edit"), !p.default && p.id !== active && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-danger btn-sm"
  }, "Delete")))))));
};
window.AdminBrandProfiles = AdminBrandProfiles;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/AdminBrandProfiles.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/AdminRoles.jsx
try { (() => {
// Admin: Roles + Permissions grid
const ROLES_DATA = [{
  id: 1,
  name: 'System',
  desc: 'Built-in. Full access. Cannot be edited.',
  perms: 60,
  builtin: true
}, {
  id: 2,
  name: 'Admin',
  desc: 'Manage users, roles, settings, brand profiles, and content.',
  perms: 48,
  builtin: true
}, {
  id: 3,
  name: 'Analyst',
  desc: 'Read-only access to analytics and event attendance.',
  perms: 12,
  builtin: true
}, {
  id: 4,
  name: 'Event Organiser',
  desc: 'Create and manage events, characters, and announcements.',
  perms: 22,
  builtin: true
}, {
  id: 5,
  name: 'User',
  desc: 'Standard member access. Create characters, post on forum, RSVP to events.',
  perms: 14,
  builtin: true
}, {
  id: 6,
  name: 'Council Member',
  desc: 'Custom role. Access to restricted forum categories and council documents.',
  perms: 18,
  builtin: false
}];
const PERMISSIONS = [{
  cat: 'Users',
  name: 'Users.View',
  desc: 'View user directory'
}, {
  cat: 'Users',
  name: 'Users.Create',
  desc: 'Add new users'
}, {
  cat: 'Users',
  name: 'Users.Approve',
  desc: 'Approve pending registrations'
}, {
  cat: 'Users',
  name: 'Users.Delete',
  desc: 'Permanently delete users'
}, {
  cat: 'Roles',
  name: 'Roles.View',
  desc: 'View roles list'
}, {
  cat: 'Roles',
  name: 'Roles.Manage',
  desc: 'Create/edit/delete roles'
}, {
  cat: 'Forum',
  name: 'Forum.Category.Create',
  desc: 'Create forum categories'
}, {
  cat: 'Forum',
  name: 'Forum.Thread.Create',
  desc: 'Start new threads'
}, {
  cat: 'Forum',
  name: 'Forum.Post.Delete',
  desc: 'Delete any post (admin)'
}, {
  cat: 'Events',
  name: 'Events.View',
  desc: 'View event listings'
}, {
  cat: 'Events',
  name: 'Events.Create',
  desc: 'Create new events'
}, {
  cat: 'Events',
  name: 'Events.Manage',
  desc: 'Edit and cancel events'
}, {
  cat: 'Wiki',
  name: 'Wiki.Page.Create',
  desc: 'Create wiki pages'
}, {
  cat: 'Wiki',
  name: 'Wiki.Page.Edit',
  desc: 'Edit any wiki page'
}, {
  cat: 'Characters',
  name: 'Characters.View',
  desc: 'View all characters'
}, {
  cat: 'Characters',
  name: 'Characters.ViewOwn',
  desc: 'View own characters'
}, {
  cat: 'Characters',
  name: 'Characters.Create',
  desc: 'Create characters'
}, {
  cat: 'Analytics',
  name: 'Analytics.View',
  desc: 'View analytics dashboards'
}, {
  cat: 'Settings',
  name: 'Settings.Manage',
  desc: 'Edit platform settings'
}, {
  cat: 'Settings',
  name: 'Settings.ManageBrandProfiles',
  desc: 'Manage brand profiles and themes'
}];
const AdminRoles = ({
  onOpenModal
}) => {
  const [editing, setEditing] = React.useState(null);
  const [selected, setSelected] = React.useState(new Set(['Users.View', 'Forum.Thread.Create', 'Events.View', 'Wiki.Page.Create', 'Characters.ViewOwn']));
  if (editing) {
    return /*#__PURE__*/React.createElement(RoleEditor, {
      role: editing,
      onClose: () => setEditing(null),
      selected: selected,
      setSelected: setSelected
    });
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Roles"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: () => setEditing({
      id: null,
      name: 'New role',
      desc: '',
      perms: 0,
      builtin: false
    })
  }, "Create Role"))), /*#__PURE__*/React.createElement("table", {
    className: "table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", null, "Description"), /*#__PURE__*/React.createElement("th", null, "Permissions"), /*#__PURE__*/React.createElement("th", null, "Actions"))), /*#__PURE__*/React.createElement("tbody", null, ROLES_DATA.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.id
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-bright)'
    }
  }, r.name), r.builtin && /*#__PURE__*/React.createElement("span", {
    className: "badge bg-secondary",
    style: {
      marginLeft: 8
    }
  }, "Built-in")), /*#__PURE__*/React.createElement("td", {
    style: {
      color: 'var(--text-muted)'
    }
  }, r.desc), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge bg-primary"
  }, r.perms)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-outline-secondary btn-sm",
    style: {
      marginRight: 6
    },
    onClick: () => setEditing(r)
  }, "Edit"), !r.builtin && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-danger btn-sm"
  }, "Delete")))))));
};
const RoleEditor = ({
  role,
  onClose,
  selected,
  setSelected
}) => {
  const [name, setName] = React.useState(role.name);
  const [desc, setDesc] = React.useState(role.desc || '');
  const toggle = name => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);else next.add(name);
    setSelected(next);
  };
  const cats = [...new Set(PERMISSIONS.map(p => p.cat))];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Edit Role"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: onClose
  }, "Save"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '1rem',
      marginBottom: '2rem'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    value: name,
    onChange: e => setName(e.target.value)
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Description"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    value: desc,
    onChange: e => setDesc(e.target.value)
  }))), /*#__PURE__*/React.createElement("div", {
    className: "analytics-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Permissions"), /*#__PURE__*/React.createElement("div", {
    className: "roles-perm-grid"
  }, cats.map(cat => /*#__PURE__*/React.createElement("div", {
    key: cat
  }, /*#__PURE__*/React.createElement("div", {
    className: "roles-perm-cat"
  }, cat), PERMISSIONS.filter(p => p.cat === cat).map(p => /*#__PURE__*/React.createElement("label", {
    key: p.name,
    className: "roles-perm-row",
    htmlFor: 'p-' + p.name
  }, /*#__PURE__*/React.createElement("input", {
    id: 'p-' + p.name,
    className: "form-check-input",
    type: "checkbox",
    style: {
      marginTop: 2
    },
    checked: selected.has(p.name),
    onChange: () => toggle(p.name)
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "roles-perm-name"
  }, p.name), /*#__PURE__*/React.createElement("div", {
    className: "roles-perm-desc"
  }, p.desc)))))))));
};
window.AdminRoles = AdminRoles;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/AdminRoles.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/AdminUsers.jsx
try { (() => {
// Admin: Users — pending approval card + main table with filters
const PENDING_USERS = [{
  id: 1,
  email: 'rosa.fell@example.com',
  firstName: 'Rosa',
  lastName: 'Fell'
}, {
  id: 2,
  email: 'idris.wode@example.com',
  firstName: 'Idris',
  lastName: 'Wode'
}, {
  id: 3,
  email: 'anya.tholme@example.com',
  firstName: 'Anya',
  lastName: 'Tholme'
}];
const USERS = [{
  id: 11,
  email: 'aiden.vale@example.com',
  firstName: 'Aiden',
  lastName: 'Vale',
  role: 'Admin',
  country: 'England',
  region: 'Vale',
  group: 'Citadel',
  status: 'Active',
  joined: '4 Mar 2022'
}, {
  id: 12,
  email: 'lyra.q@example.com',
  firstName: 'Lyra',
  lastName: 'Quill',
  role: 'Event Organiser',
  country: 'England',
  region: 'Aerin',
  group: 'Long Hall',
  status: 'Active',
  joined: '18 Jul 2023'
}, {
  id: 13,
  email: 'bren.tor@example.com',
  firstName: 'Bren',
  lastName: 'Tor',
  role: 'User',
  country: 'Scotland',
  region: 'Frostmarch',
  group: 'Northwatch',
  status: 'Active',
  joined: '2 Jan 2024'
}, {
  id: 14,
  email: 'sera.mae@example.com',
  firstName: 'Sera',
  lastName: 'Mae',
  role: 'Analyst',
  country: 'England',
  region: 'Vale',
  group: 'House Mae',
  status: 'Active',
  joined: '22 Sep 2024'
}, {
  id: 15,
  email: 'iorek.vahn@example.com',
  firstName: 'Iorek',
  lastName: 'Vahn',
  role: 'Event Organiser',
  country: 'Scotland',
  region: 'Northern',
  group: 'Marches',
  status: 'Active',
  joined: '14 Nov 2023'
}, {
  id: 16,
  email: 'mira.quen@example.com',
  firstName: 'Mira',
  lastName: 'Quen',
  role: 'User',
  country: 'England',
  region: 'Vale',
  group: 'Council',
  status: 'Inactive',
  joined: '8 Apr 2024'
}, {
  id: 17,
  email: 'old.cael@example.com',
  firstName: 'Cael',
  lastName: 'Oldwyn',
  role: 'User',
  country: 'Wales',
  region: 'Cymru',
  group: 'Cymru Cell',
  status: 'Active',
  joined: '30 Jun 2024'
}];
const AdminUsers = ({
  onOpenModal
}) => {
  const [pending, setPending] = React.useState(PENDING_USERS);
  const [search, setSearch] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [role, setRole] = React.useState('');
  const filtered = USERS.filter(u => (!search || (u.firstName + ' ' + u.lastName + ' ' + u.email).toLowerCase().includes(search.toLowerCase())) && (!country || u.country === country) && (!role || u.role === role));
  const approve = id => setPending(p => p.filter(x => x.id !== id));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Users"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: () => onOpenModal({
      kind: 'user-new'
    })
  }, "Create User"))), pending.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card admin-pending-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-header"
  }, "Awaiting Approval", /*#__PURE__*/React.createElement("span", {
    className: "admin-pending-count"
  }, pending.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "table",
    style: {
      margin: 0,
      border: 'none',
      borderRadius: 0
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Email"), /*#__PURE__*/React.createElement("th", null, "First name"), /*#__PURE__*/React.createElement("th", null, "Last name"), /*#__PURE__*/React.createElement("th", null, "Action"))), /*#__PURE__*/React.createElement("tbody", null, pending.map(p => /*#__PURE__*/React.createElement("tr", {
    key: p.id
  }, /*#__PURE__*/React.createElement("td", null, p.email), /*#__PURE__*/React.createElement("td", null, p.firstName), /*#__PURE__*/React.createElement("td", null, p.lastName), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-success btn-sm",
    onClick: () => approve(p.id)
  }, "Approve")))))))), /*#__PURE__*/React.createElement("div", {
    className: "admin-filters"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Search"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    placeholder: "Name or email\u2026",
    value: search,
    onChange: e => setSearch(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Country"), /*#__PURE__*/React.createElement("select", {
    className: "form-control form-control-sm",
    value: country,
    onChange: e => setCountry(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "All"), /*#__PURE__*/React.createElement("option", null, "England"), /*#__PURE__*/React.createElement("option", null, "Scotland"), /*#__PURE__*/React.createElement("option", null, "Wales"))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Role"), /*#__PURE__*/React.createElement("select", {
    className: "form-control form-control-sm",
    value: role,
    onChange: e => setRole(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "All"), /*#__PURE__*/React.createElement("option", null, "Admin"), /*#__PURE__*/React.createElement("option", null, "Event Organiser"), /*#__PURE__*/React.createElement("option", null, "Analyst"), /*#__PURE__*/React.createElement("option", null, "User"))), /*#__PURE__*/React.createElement("div", {
    className: "field",
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label",
    style: {
      visibility: 'hidden'
    }
  }, "."), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-outline-secondary btn-sm",
    onClick: () => {
      setSearch('');
      setCountry('');
      setRole('');
    }
  }, "Clear filters"))), /*#__PURE__*/React.createElement("table", {
    className: "table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Member"), /*#__PURE__*/React.createElement("th", null, "Email"), /*#__PURE__*/React.createElement("th", null, "Role"), /*#__PURE__*/React.createElement("th", null, "Region / Group"), /*#__PURE__*/React.createElement("th", null, "Joined"), /*#__PURE__*/React.createElement("th", null, "Status"), /*#__PURE__*/React.createElement("th", null, "Actions"))), /*#__PURE__*/React.createElement("tbody", null, filtered.map(u => /*#__PURE__*/React.createElement("tr", {
    key: u.id
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-bright)'
    }
  }, u.firstName, " ", u.lastName)), /*#__PURE__*/React.createElement("td", null, u.email), /*#__PURE__*/React.createElement("td", null, u.role), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, u.region, " \xB7 ", u.group)), /*#__PURE__*/React.createElement("td", null, u.joined), /*#__PURE__*/React.createElement("td", null, u.status === 'Active' ? /*#__PURE__*/React.createElement("span", {
    className: "badge bg-success"
  }, "Active") : /*#__PURE__*/React.createElement("span", {
    className: "badge bg-secondary"
  }, "Inactive")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-outline-secondary btn-sm",
    style: {
      marginRight: 6
    }
  }, "Edit"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-danger btn-sm"
  }, "Delete")))), filtered.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 7,
    style: {
      textAlign: 'center',
      color: 'var(--text-muted)',
      padding: '2rem'
    }
  }, "No matching members.")))));
};
window.AdminUsers = AdminUsers;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/AdminUsers.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Analytics.jsx
try { (() => {
// Analytics — three sub-screens with proper filter bars, flagged rows,
// action-detail modal, big chart, and expandable event-attendance cards.

const ACTION_TYPES = ['UserLogin', 'UserLogout', 'UserApproved', 'UserSuspended', 'UserDeleted', 'RoleAssigned', 'RoleRevoked', 'ForumPostCreated', 'ForumPostEdited', 'ForumPostDeleted', 'ForumThreadCreated', 'WikiPageCreated', 'WikiPageEdited', 'WikiPageViewed', 'EventCreated', 'EventEdited', 'EventCancelled', 'EventRsvpCreated', 'EventRsvpCancelled', 'AnnouncementCreated', 'AnnouncementSeen', 'CharacterCreated', 'CharacterUpdated', 'CharacterDeleted', 'DocumentUploaded', 'DocumentDownloaded'];
const SUMMARY = {
  today: 142,
  week: 1284,
  month: 5217,
  uniqueUsersWeek: 87,
  loginsToday: 38,
  loginsWeek: 412
};
const TOP_ACTIONS = [{
  type: 'ForumPostCreated',
  count: 312
}, {
  type: 'EventViewed',
  count: 287
}, {
  type: 'WikiPageViewed',
  count: 254
}, {
  type: 'CharacterUpdated',
  count: 188
}, {
  type: 'AnnouncementSeen',
  count: 121
}, {
  type: 'DocumentDownloaded',
  count: 96
}];

// Synthesised action log entries; 28 of them so pagination has something to do.
const LOG_DATA = (() => {
  const users = [{
    name: 'Aiden Vale',
    email: 'aiden.vale@example.com',
    role: 'Admin'
  }, {
    name: 'Lyra Quill',
    email: 'lyra.q@example.com',
    role: 'EventOrganiser'
  }, {
    name: 'Bren Tor',
    email: 'bren.tor@example.com',
    role: 'User'
  }, {
    name: 'Sera Mae',
    email: 'sera.mae@example.com',
    role: 'Analyst'
  }, {
    name: 'Iorek Vahn',
    email: 'iorek.vahn@example.com',
    role: 'EventOrganiser'
  }, {
    name: 'Mira Quen',
    email: 'mira.quen@example.com',
    role: 'User'
  }, {
    name: 'Cael Oldwyn',
    email: 'old.cael@example.com',
    role: 'User'
  }];
  const targets = ['Encounter rules v3', 'The Founding of Aerin', 'Winter Convocation', 'Lady Vespera', 'Solstice Hunt rules.pdf', 'rosa.fell@example.com', 'Council Member', 'Chronicler\'s Roundtable'];
  const out = [];
  let when = Date.now();
  for (let i = 0; i < 28; i++) {
    const u = users[i % users.length];
    const type = ACTION_TYPES[i * 3 % ACTION_TYPES.length];
    const target = targets[i * 5 % targets.length];
    when -= (5 + i % 7) * 60 * 1000; // 5–11 minutes apart
    out.push({
      id: i + 1,
      occurredAt: new Date(when),
      type,
      actor: u,
      target,
      details: i % 9 === 0 ? 'Triggered from the admin console.' : null,
      isFlagged: i === 2,
      // 1 manually flagged
      isRuleFlagged: i === 5 || i === 12,
      // 2 rule-flagged
      flagReason: i === 2 ? 'Repeated approvals from same IP' : null,
      ruleReason: i === 5 ? 'Bulk RSVP cancel pattern' : i === 12 ? 'Role-action: User → ForumPostDeleted' : null
    });
  }
  return out;
})();
const PRESETS = [{
  label: 'Today',
  days: 1
}, {
  label: 'Last 7 days',
  days: 7
}, {
  label: 'Last 30 days',
  days: 30
}, {
  label: 'Last 90 days',
  days: 90
}, {
  label: 'All time',
  days: null
}];
const formatTime = d => d.toLocaleString('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});
const initials = name => name.split(/\s+/).map(p => p[0]).join('').slice(0, 2);
const Analytics = ({
  initialTab = 'log'
}) => {
  const [tab, setTab] = React.useState(initialTab);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Analytics"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-muted)',
      margin: '0.25rem 0 0',
      fontFamily: 'var(--font-body)'
    }
  }, "Activity, attendance, and flagged behaviour across the community.")), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("div", {
    className: "analytics-tabs"
  }, /*#__PURE__*/React.createElement("a", {
    className: "nav-pill" + (tab === 'log' ? ' nav-pill--active' : ''),
    href: "#",
    onClick: e => {
      e.preventDefault();
      setTab('log');
    }
  }, "Action Log"), /*#__PURE__*/React.createElement("a", {
    className: "nav-pill" + (tab === 'charts' ? ' nav-pill--active' : ''),
    href: "#",
    onClick: e => {
      e.preventDefault();
      setTab('charts');
    }
  }, "Activity Charts"), /*#__PURE__*/React.createElement("a", {
    className: "nav-pill" + (tab === 'attendances' ? ' nav-pill--active' : ''),
    href: "#",
    onClick: e => {
      e.preventDefault();
      setTab('attendances');
    }
  }, "Event Attendances")))), /*#__PURE__*/React.createElement("div", {
    className: "analytics-summary-grid"
  }, /*#__PURE__*/React.createElement(Stat, {
    label: "Actions today",
    value: SUMMARY.today,
    delta: "+18% vs yesterday",
    up: true
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Actions this week",
    value: SUMMARY.week.toLocaleString(),
    delta: "+6% vs last week",
    up: true
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Actions this month",
    value: SUMMARY.month.toLocaleString(),
    delta: "\u2014"
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Unique users (week)",
    value: SUMMARY.uniqueUsersWeek,
    delta: "+4 vs last week",
    up: true
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Logins today",
    value: SUMMARY.loginsToday,
    delta: "\u22129% vs yesterday",
    down: true
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Logins this week",
    value: SUMMARY.loginsWeek,
    delta: "+2% vs last week",
    up: true
  })), tab === 'log' && /*#__PURE__*/React.createElement(AnalyticsLog, null), tab === 'charts' && /*#__PURE__*/React.createElement(AnalyticsCharts, null), tab === 'attendances' && /*#__PURE__*/React.createElement(AnalyticsAttendances, null));
};
const Stat = ({
  label,
  value,
  delta,
  up,
  down
}) => /*#__PURE__*/React.createElement("div", {
  className: "analytics-stat"
}, /*#__PURE__*/React.createElement("span", {
  className: "analytics-stat-label"
}, label), /*#__PURE__*/React.createElement("div", {
  className: "analytics-stat-value"
}, value), delta && /*#__PURE__*/React.createElement("div", {
  className: "analytics-stat-delta" + (up ? ' analytics-stat-delta--up' : '') + (down ? ' analytics-stat-delta--down' : '')
}, delta));

// ─── Action Log ──────────────────────────────────────────────────────────────
const AnalyticsLog = () => {
  const [filterType, setFilterType] = React.useState('');
  const [filterUser, setFilterUser] = React.useState('');
  const [filterFrom, setFilterFrom] = React.useState('');
  const [filterTo, setFilterTo] = React.useState('');
  const [page, setPage] = React.useState(1);
  const pageSize = 10;
  const [selected, setSelected] = React.useState(null);
  const apply = () => setPage(1);
  const clear = () => {
    setFilterType('');
    setFilterUser('');
    setFilterFrom('');
    setFilterTo('');
    setPage(1);
  };
  const filtered = LOG_DATA.filter(e => (!filterType || e.type === filterType) && (!filterUser || (e.actor.name + ' ' + e.actor.email).toLowerCase().includes(filterUser.toLowerCase())));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "analytics-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Top action types \xB7 this week"), /*#__PURE__*/React.createElement("div", {
    className: "top-actions-list"
  }, TOP_ACTIONS.map(a => /*#__PURE__*/React.createElement("div", {
    className: "row",
    key: a.type
  }, /*#__PURE__*/React.createElement("span", {
    className: "name"
  }, a.type), /*#__PURE__*/React.createElement("div", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: a.count / TOP_ACTIONS[0].count * 100 + '%'
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, a.count))))), /*#__PURE__*/React.createElement("div", {
    className: "an-filter-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "an-filter-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Action type"), /*#__PURE__*/React.createElement("select", {
    className: "form-control form-control-sm",
    value: filterType,
    onChange: e => setFilterType(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "All types"), ACTION_TYPES.map(t => /*#__PURE__*/React.createElement("option", {
    key: t
  }, t)))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "User"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    placeholder: "Name or email\u2026",
    value: filterUser,
    onChange: e => setFilterUser(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "From"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    type: "date",
    value: filterFrom,
    onChange: e => setFilterFrom(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "To"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    type: "date",
    value: filterTo,
    onChange: e => setFilterTo(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field field--actions"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label",
    style: {
      visibility: 'hidden'
    }
  }, "."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '0.4rem'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-gold",
    onClick: apply
  }, "Apply"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: clear
  }, "Clear"))))), filtered.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "alert alert-info",
    style: {
      margin: 0
    }
  }, "No actions match the current filters.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("table", {
    className: "an-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null), /*#__PURE__*/React.createElement("th", null, "When"), /*#__PURE__*/React.createElement("th", null, "Action"), /*#__PURE__*/React.createElement("th", null, "User"), /*#__PURE__*/React.createElement("th", null, "Role"), /*#__PURE__*/React.createElement("th", null, "Target"))), /*#__PURE__*/React.createElement("tbody", null, slice.map(e => /*#__PURE__*/React.createElement("tr", {
    key: e.id,
    className: e.isFlagged ? 'an-row-flagged' : e.isRuleFlagged ? 'an-row-flagged-rule' : '',
    onClick: () => setSelected(e)
  }, /*#__PURE__*/React.createElement("td", {
    className: "an-cell-flag"
  }, e.isFlagged && /*#__PURE__*/React.createElement("span", {
    className: "an-flag--direct",
    title: e.flagReason
  }, "\u2691"), !e.isFlagged && e.isRuleFlagged && /*#__PURE__*/React.createElement("span", {
    className: "an-flag--rule",
    title: e.ruleReason
  }, "\u2691")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "an-cell-time"
  }, formatTime(e.occurredAt))), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "an-cell-type"
  }, e.type)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-bright)'
    }
  }, e.actor.name), /*#__PURE__*/React.createElement("span", {
    className: "an-actor-email"
  }, e.actor.email)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge bg-primary"
  }, e.actor.role)), /*#__PURE__*/React.createElement("td", {
    style: {
      color: 'var(--text-muted)'
    }
  }, e.target))))), /*#__PURE__*/React.createElement("div", {
    className: "an-pagination"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: () => setPage(p => Math.max(1, p - 1)),
    disabled: page <= 1
  }, "Previous"), /*#__PURE__*/React.createElement("span", {
    className: "an-pagination__info"
  }, "Page ", page, " of ", totalPages, " \xB7 ", filtered.length, " actions"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary btn-sm",
    onClick: () => setPage(p => Math.min(totalPages, p + 1)),
    disabled: page >= totalPages
  }, "Next"))), selected && /*#__PURE__*/React.createElement(ActionDetailModal, {
    action: selected,
    onClose: () => setSelected(null)
  }));
};
const ActionDetailModal = ({
  action,
  onClose
}) => /*#__PURE__*/React.createElement(Modal, {
  open: true,
  onClose: onClose,
  title: "Action detail",
  footer: /*#__PURE__*/React.createElement(React.Fragment, null, !action.isFlagged && /*#__PURE__*/React.createElement("button", {
    className: "btn btn-danger btn-sm"
  }, "\u2691 Flag manually"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    onClick: onClose
  }, "Close"))
}, /*#__PURE__*/React.createElement("div", {
  className: "an-detail-grid"
}, action.isFlagged && /*#__PURE__*/React.createElement("div", {
  className: "an-detail-section an-detail-section--flag"
}, /*#__PURE__*/React.createElement("h3", {
  className: "an-detail-title",
  style: {
    color: 'var(--danger)'
  }
}, "\u2691 Manually flagged"), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Reason"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value"
}, action.flagReason))), !action.isFlagged && action.isRuleFlagged && /*#__PURE__*/React.createElement("div", {
  className: "an-detail-section an-detail-section--rule"
}, /*#__PURE__*/React.createElement("h3", {
  className: "an-detail-title",
  style: {
    color: 'var(--warning)'
  }
}, "\u2691 Matched a flag rule"), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Rule"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value"
}, action.ruleReason))), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-section"
}, /*#__PURE__*/React.createElement("h3", {
  className: "an-detail-title"
}, "Action"), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Type"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value",
  style: {
    color: 'var(--accent)',
    fontWeight: 600
  }
}, action.type)), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "When"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value"
}, formatTime(action.occurredAt))), action.target && /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Target"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value"
}, action.target)), action.details && /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Details"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value"
}, action.details))), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-section"
}, /*#__PURE__*/React.createElement("h3", {
  className: "an-detail-title"
}, "Who did it"), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Name"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value",
  style: {
    fontWeight: 600
  }
}, action.actor.name)), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Email"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value"
}, action.actor.email)), /*#__PURE__*/React.createElement("div", {
  className: "an-detail-row"
}, /*#__PURE__*/React.createElement("span", {
  className: "an-detail-label"
}, "Role"), /*#__PURE__*/React.createElement("span", {
  className: "an-detail-value"
}, /*#__PURE__*/React.createElement("span", {
  className: "badge bg-primary"
}, action.actor.role))))));

// ─── Activity Charts ────────────────────────────────────────────────────────
const AnalyticsCharts = () => {
  const [preset, setPreset] = React.useState('Last 30 days');
  const [groupBy, setGroupBy] = React.useState('day');
  const [eventType, setEventType] = React.useState('');
  const data = React.useMemo(() => {
    // Generate plausible per-day data for the chart length
    const n = groupBy === 'day' ? 30 : groupBy === 'week' ? 12 : 6;
    return Array.from({
      length: n
    }, (_, i) => {
      const base = 20 + Math.round(Math.sin(i / 3) * 15 + i * 1.2);
      return Math.max(4, base + i * 7 % 18 - 6);
    });
  }, [groupBy, preset, eventType]);
  const max = Math.max(...data);
  const labels = (() => {
    if (groupBy === 'day') {
      return Array.from({
        length: 30
      }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        return i % 4 === 0 ? d.getDate() : '';
      });
    }
    if (groupBy === 'week') {
      return ['W-11', 'W-10', 'W-9', 'W-8', 'W-7', 'W-6', 'W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'This'];
    }
    return ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
  })();
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "an-filter-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "an-filter-presets"
  }, PRESETS.map(p => /*#__PURE__*/React.createElement("button", {
    key: p.label,
    className: "preset-btn" + (preset === p.label ? ' preset-btn--active' : ''),
    onClick: () => setPreset(p.label)
  }, p.label))), /*#__PURE__*/React.createElement("div", {
    className: "an-filter-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "From"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    type: "datetime-local"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "To"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    type: "datetime-local"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Group by"), /*#__PURE__*/React.createElement("select", {
    className: "form-control form-control-sm",
    value: groupBy,
    onChange: e => setGroupBy(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "day"
  }, "Day"), /*#__PURE__*/React.createElement("option", {
    value: "week"
  }, "Week"), /*#__PURE__*/React.createElement("option", {
    value: "month"
  }, "Month"))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Event type"), /*#__PURE__*/React.createElement("select", {
    className: "form-control form-control-sm",
    value: eventType,
    onChange: e => setEventType(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "All types"), ACTION_TYPES.map(t => /*#__PURE__*/React.createElement("option", {
    key: t
  }, t)))), /*#__PURE__*/React.createElement("div", {
    className: "field field--actions"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label",
    style: {
      visibility: 'hidden'
    }
  }, "."), /*#__PURE__*/React.createElement("button", {
    className: "btn-gold"
  }, "Apply")))), /*#__PURE__*/React.createElement("div", {
    className: "an-chart-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "an-chart-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "an-chart-title"
  }, "Actions over time"), /*#__PURE__*/React.createElement("span", {
    className: "an-chart-meta"
  }, preset, " \xB7 grouped by ", groupBy, " \xB7 ", eventType || 'all types')), /*#__PURE__*/React.createElement("div", {
    className: "an-chart-canvas"
  }, data.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      height: v / max * 100 + '%'
    },
    "data-v": v + ' actions'
  }))), /*#__PURE__*/React.createElement("div", {
    className: "an-chart-axis"
  }, labels.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, l)))), /*#__PURE__*/React.createElement("div", {
    className: "analytics-section"
  }, /*#__PURE__*/React.createElement("h2", null, "By module"), /*#__PURE__*/React.createElement("div", {
    className: "top-actions-list"
  }, [{
    type: 'Forum',
    count: 612
  }, {
    type: 'Events',
    count: 487
  }, {
    type: 'Wiki',
    count: 354
  }, {
    type: 'Characters',
    count: 228
  }, {
    type: 'Announcements',
    count: 141
  }, {
    type: 'Documents',
    count: 96
  }].map(a => /*#__PURE__*/React.createElement("div", {
    className: "row",
    key: a.type
  }, /*#__PURE__*/React.createElement("span", {
    className: "name"
  }, a.type), /*#__PURE__*/React.createElement("div", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: a.count / 612 * 100 + '%'
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, a.count))))));
};

// ─── Event Attendances ──────────────────────────────────────────────────────
const EVENTS_ATTENDANCE = [{
  id: 1,
  title: 'Winter Convocation',
  date: new Date('2026-11-18'),
  deleted: false,
  going: [{
    name: 'Aiden Vale',
    email: 'aiden.vale@example.com',
    rsvpAt: 'Oct 24'
  }, {
    name: 'Lyra Quill',
    email: 'lyra.q@example.com',
    rsvpAt: 'Oct 25'
  }, {
    name: 'Bren Tor',
    email: 'bren.tor@example.com',
    rsvpAt: 'Oct 26'
  }, {
    name: 'Sera Mae',
    email: 'sera.mae@example.com',
    rsvpAt: 'Oct 27'
  }, {
    name: 'Iorek Vahn',
    email: 'iorek.vahn@example.com',
    rsvpAt: 'Oct 28'
  }, {
    name: 'Mira Quen',
    email: 'mira.quen@example.com',
    rsvpAt: 'Nov 1'
  }],
  cancelled: [{
    name: 'Tora Felk',
    email: 'tora.f@example.com',
    daysBefore: 12
  }, {
    name: 'Hess Andren',
    email: 'hess.a@example.com',
    daysBefore: 4
  }]
}, {
  id: 2,
  title: 'Chronicler\'s Roundtable',
  date: new Date('2026-12-02'),
  deleted: false,
  going: [{
    name: 'Lyra Quill',
    email: 'lyra.q@example.com',
    rsvpAt: 'Nov 12'
  }, {
    name: 'Sera Mae',
    email: 'sera.mae@example.com',
    rsvpAt: 'Nov 15'
  }, {
    name: 'Cael Oldwyn',
    email: 'old.cael@example.com',
    rsvpAt: 'Nov 18'
  }],
  cancelled: []
}, {
  id: 3,
  title: 'Solstice Hunt',
  date: new Date('2026-12-14'),
  deleted: false,
  going: [{
    name: 'Iorek Vahn',
    email: 'iorek.vahn@example.com',
    rsvpAt: 'Nov 1'
  }, {
    name: 'Bren Tor',
    email: 'bren.tor@example.com',
    rsvpAt: 'Nov 3'
  }, {
    name: 'Aiden Vale',
    email: 'aiden.vale@example.com',
    rsvpAt: 'Nov 5'
  }, {
    name: 'Mira Quen',
    email: 'mira.quen@example.com',
    rsvpAt: 'Nov 8'
  }],
  cancelled: [{
    name: 'Sera Mae',
    email: 'sera.mae@example.com',
    daysBefore: 21
  }]
}, {
  id: 4,
  title: 'Autumn Faire',
  date: new Date('2026-10-21'),
  deleted: false,
  going: [{
    name: 'Aiden Vale',
    email: 'aiden.vale@example.com',
    rsvpAt: 'Sep 14'
  }, {
    name: 'Lyra Quill',
    email: 'lyra.q@example.com',
    rsvpAt: 'Sep 18'
  }],
  cancelled: []
}, {
  id: 5,
  title: 'Harvest Council (cancelled)',
  date: new Date('2026-09-30'),
  deleted: true,
  going: [],
  cancelled: [{
    name: 'Mira Quen',
    email: 'mira.quen@example.com',
    daysBefore: 6
  }, {
    name: 'Bren Tor',
    email: 'bren.tor@example.com',
    daysBefore: 9
  }]
}];
const AnalyticsAttendances = () => {
  const [search, setSearch] = React.useState('');
  const [showEmpty, setShowEmpty] = React.useState(true);
  const [showDeleted, setShowDeleted] = React.useState(false);
  const [upcomingOnly, setUpcomingOnly] = React.useState(false);
  const [minDays, setMinDays] = React.useState('');
  const [maxDays, setMaxDays] = React.useState('');
  const [expanded, setExpanded] = React.useState(new Set([1])); // first event expanded by default

  const now = new Date();
  const filtered = EVENTS_ATTENDANCE.filter(e => (!search || e.title.toLowerCase().includes(search.toLowerCase())) && (showEmpty || e.going.length > 0 || e.cancelled.length > 0) && (showDeleted || !e.deleted) && (!upcomingOnly || e.date >= now)).map(e => {
    const cancelled = e.cancelled.filter(c => (!minDays || c.daysBefore >= +minDays) && (!maxDays || c.daysBefore <= +maxDays));
    return {
      ...e,
      cancelled
    };
  });
  const toggle = id => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);else next.add(id);
    setExpanded(next);
  };
  const totalGoing = filtered.reduce((s, e) => s + e.going.length, 0);
  const totalCancelled = filtered.reduce((s, e) => s + e.cancelled.length, 0);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "an-filter-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "an-filter-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field",
    style: {
      flex: '2 1 240px'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Search events"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    placeholder: "Title\u2026",
    value: search,
    onChange: e => setSearch(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Min days before"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    type: "number",
    min: 0,
    placeholder: "0",
    value: minDays,
    onChange: e => setMinDays(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Max days before"), /*#__PURE__*/React.createElement("input", {
    className: "form-control form-control-sm",
    type: "number",
    min: 0,
    placeholder: "Any",
    value: maxDays,
    onChange: e => setMaxDays(e.target.value)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1.25rem',
      marginTop: '0.85rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "audience-toggle",
    style: {
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: showEmpty,
    onChange: e => setShowEmpty(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: '0.85rem'
    }
  }, "Show events with no attendees")), /*#__PURE__*/React.createElement("label", {
    className: "audience-toggle",
    style: {
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: showDeleted,
    onChange: e => setShowDeleted(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: '0.85rem'
    }
  }, "Include deleted events")), /*#__PURE__*/React.createElement("label", {
    className: "audience-toggle",
    style: {
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: upcomingOnly,
    onChange: e => setUpcomingOnly(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: '0.85rem'
    }
  }, "Upcoming only")))), filtered.length > 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-muted)',
      fontSize: '0.85rem',
      margin: '0 0 1rem',
      fontFamily: 'var(--font-body)'
    }
  }, "Showing ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text)'
    }
  }, filtered.length), " events \xB7", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--success)'
    }
  }, " ", totalGoing, " attending"), " \xB7", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--danger)'
    }
  }, " ", totalCancelled, " cancellations")), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "alert alert-info",
    style: {
      margin: 0
    }
  }, "No events match the current filters."), filtered.map(e => {
    const open = expanded.has(e.id);
    return /*#__PURE__*/React.createElement("div", {
      key: e.id,
      className: "ev-attend-card" + (e.deleted ? ' ev-attend-card--deleted' : '')
    }, /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-head",
      onClick: () => toggle(e.id)
    }, /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-head__info"
    }, /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-head__title"
    }, e.title, e.deleted && /*#__PURE__*/React.createElement("span", {
      className: "badge bg-danger",
      style: {
        marginLeft: 8
      }
    }, "Deleted")), /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-head__date"
    }, e.date.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }))), /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-stats"
    }, /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-pill ev-attend-pill--going"
    }, e.going.length, " going"), e.cancelled.length > 0 && /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-pill ev-attend-pill--cancelled"
    }, e.cancelled.length, " cancelled"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        fontSize: '0.9rem'
      }
    }, open ? '▴' : '▾'))), open && /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-section"
    }, /*#__PURE__*/React.createElement("h4", {
      className: "ev-attend-section__title"
    }, "Currently going \xB7 ", e.going.length), e.going.length === 0 ? /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-empty"
    }, "No one has RSVP'd yet.") : e.going.map(p => /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-row",
      key: p.email
    }, /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-row__avatar"
    }, initials(p.name)), /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-row__name"
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--text-bright)'
      }
    }, p.name), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        marginLeft: 6,
        fontSize: '0.8rem'
      }
    }, p.email)), /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-row__meta"
    }, "RSVP'd ", p.rsvpAt)))), e.cancelled.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-section"
    }, /*#__PURE__*/React.createElement("h4", {
      className: "ev-attend-section__title"
    }, "Cancelled \xB7 ", e.cancelled.length), e.cancelled.map(p => /*#__PURE__*/React.createElement("div", {
      className: "ev-attend-row",
      key: p.email
    }, /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-row__avatar"
    }, initials(p.name)), /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-row__name"
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--text-bright)'
      }
    }, p.name), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        marginLeft: 6,
        fontSize: '0.8rem'
      }
    }, p.email)), /*#__PURE__*/React.createElement("span", {
      className: "ev-attend-row__meta"
    }, p.daysBefore, " days before"))))));
  }));
};
window.Analytics = Analytics;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Analytics.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Announcements.jsx
try { (() => {
// Announcements — list of announcements with side date stamp + create modal
// with the same audience-tree restriction UI as Forum.
const ANNOUNCEMENTS_DATA = [{
  id: 1,
  title: 'Winter Convocation — registration closes Friday',
  body: 'Final call. If you haven\'t booked your place yet, do so before close of business Friday so we can confirm catering numbers.',
  date: new Date('2026-11-18'),
  author: 'A. Vale',
  linkedEvent: 'Winter Convocation',
  restricted: null
}, {
  id: 2,
  title: 'Council motion — vote opens Monday',
  body: 'A motion to revise the encounter-rules supplement has been tabled. Voting opens Monday and runs for one week. Council members only.',
  date: new Date('2026-11-12'),
  author: 'L. Quill',
  linkedEvent: null,
  restricted: {
    countries: new Set(),
    regions: new Set(['Vale']),
    groups: new Set(['Council']),
    tierLevels: new Set([11]),
    roles: ['Admin', 'EventOrganiser'],
    positions: []
  }
}, {
  id: 3,
  title: 'New chapter opens in Cymru',
  body: 'We\'re delighted to welcome the Cymru cell as the newest chapter of the community. Their first event runs in March; details in the Events tab.',
  date: new Date('2026-11-08'),
  author: 'A. Vale',
  linkedEvent: null,
  restricted: null
}, {
  id: 4,
  title: 'Site maintenance · 02:00 Sunday',
  body: 'The site will be unavailable for approximately 30 minutes from 02:00 BST on Sunday for a database migration.',
  date: new Date('2026-11-04'),
  author: 'System',
  linkedEvent: null,
  restricted: null
}];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const Announcements = () => {
  const [items, setItems] = React.useState(ANNOUNCEMENTS_DATA);
  const [editing, setEditing] = React.useState(null);
  const openCreate = () => setEditing({
    id: null,
    title: '',
    body: '',
    restricted: null,
    linkedEvent: null
  });
  const save = data => {
    if (data.id) {
      setItems(prev => prev.map(a => a.id === data.id ? {
        ...a,
        ...data
      } : a));
    } else {
      setItems(prev => [{
        id: Date.now(),
        title: data.title || 'Untitled',
        body: data.body,
        date: new Date(),
        author: 'A. Vale',
        linkedEvent: data.linkedEvent || null,
        restricted: data.restricted
      }, ...prev]);
    }
    setEditing(null);
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Announcements"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-gold-outline",
    onClick: openCreate
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 14
  }), " New Announcement"))), /*#__PURE__*/React.createElement("div", {
    className: "ann-list"
  }, items.map(a => /*#__PURE__*/React.createElement("article", {
    className: "ann-card",
    key: a.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "ann-card__date"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ann-card__day"
  }, a.date.getDate()), /*#__PURE__*/React.createElement("span", {
    className: "ann-card__month"
  }, MONTHS[a.date.getMonth()]), /*#__PURE__*/React.createElement("span", {
    className: "ann-card__year"
  }, a.date.getFullYear())), /*#__PURE__*/React.createElement("div", {
    className: "ann-card__content"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "ann-card__title"
  }, a.title), /*#__PURE__*/React.createElement("p", {
    className: "ann-card__excerpt"
  }, a.body), /*#__PURE__*/React.createElement("div", {
    className: "ann-card__footer"
  }, /*#__PURE__*/React.createElement("span", null, "by ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text)'
    }
  }, a.author)), a.linkedEvent && /*#__PURE__*/React.createElement("span", {
    className: "restricted-pill",
    style: {
      background: 'var(--accent-muted)',
      border: '1px solid var(--accent-border-glow)'
    }
  }, /*#__PURE__*/React.createElement(IconCalendar, {
    size: 11
  }), " ", a.linkedEvent), a.restricted && /*#__PURE__*/React.createElement("span", {
    className: "restricted-pill",
    title: AudienceTree.summary(a.restricted)
  }, /*#__PURE__*/React.createElement(IconKey, {
    size: 11
  }), " Restricted \xB7 ", AudienceTree.summary(a.restricted)))), /*#__PURE__*/React.createElement("div", {
    className: "ann-card__chevron"
  }, "\u203A")))), editing && /*#__PURE__*/React.createElement(AnnouncementModal, {
    initial: editing,
    onClose: () => setEditing(null),
    onSave: save
  }));
};
const AnnouncementModal = ({
  initial,
  onClose,
  onSave
}) => {
  const [title, setTitle] = React.useState(initial.title || '');
  const [body, setBody] = React.useState(initial.body || '');
  const [linkedEvent, setLinkedEvent] = React.useState(initial.linkedEvent || '');
  const [restrict, setRestrict] = React.useState(!!initial.restricted);
  const [audience, setAudience] = React.useState(initial.restricted || AudienceTree.empty());
  const submit = () => {
    onSave({
      id: initial.id,
      title,
      body,
      linkedEvent: linkedEvent || null,
      restricted: restrict ? audience : null
    });
  };
  return /*#__PURE__*/React.createElement(Modal, {
    open: true,
    onClose: onClose,
    title: initial.id ? 'Edit Announcement' : 'New Announcement',
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      onClick: onClose
    }, "Cancel"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: submit
    }, "Post"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Title"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "A short, scannable headline",
    value: title,
    onChange: e => setTitle(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Body"), /*#__PURE__*/React.createElement("textarea", {
    className: "form-control",
    rows: 5,
    placeholder: "Write the announcement here. Plain text or short paragraphs.",
    value: body,
    onChange: e => setBody(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '0.5rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Link to an event (optional)"), /*#__PURE__*/React.createElement("select", {
    className: "form-control",
    value: linkedEvent,
    onChange: e => setLinkedEvent(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u2014 No linked event \u2014"), /*#__PURE__*/React.createElement("option", null, "Winter Convocation"), /*#__PURE__*/React.createElement("option", null, "Chronicler's Roundtable"), /*#__PURE__*/React.createElement("option", null, "Solstice Hunt"), /*#__PURE__*/React.createElement("option", null, "Yearend Council"))), /*#__PURE__*/React.createElement("label", {
    className: "audience-toggle"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: restrict,
    onChange: e => setRestrict(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", null, "Restrict audience")), restrict && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '0.5rem'
    }
  }, /*#__PURE__*/React.createElement(AudienceTree, {
    value: audience,
    onChange: setAudience
  })));
};
window.Announcements = Announcements;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Announcements.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/AudienceTree.jsx
try { (() => {
// AudienceTree — reusable tri-state checkbox tree used in Forum + Announcements.
// Mirrors the pattern in Forum.razor + Announcements.razor (Country → Region → Group).

// Community hierarchy — what an admin would have configured under CommunitySettings.
const COMMUNITY_HIERARCHY = [{
  name: 'England',
  regions: [{
    name: 'Vale',
    groups: ['Citadel', 'House Mae', 'Council']
  }, {
    name: 'Aerin',
    groups: ['Long Hall', 'Chronicler\'s Guild']
  }, {
    name: 'Westmarch',
    groups: ['Hearthside', 'Riverwatch']
  }]
}, {
  name: 'Scotland',
  regions: [{
    name: 'Frostmarch',
    groups: ['Northwatch', 'Marches']
  }, {
    name: 'Highlands',
    groups: ['Crannog']
  }]
}, {
  name: 'Wales',
  regions: [{
    name: 'Cymru',
    groups: ['Cymru Cell']
  }]
}];
const TIER_CATEGORIES = [{
  id: 1,
  name: 'Membership',
  levels: [{
    id: 11,
    name: 'Full Member'
  }, {
    id: 12,
    name: 'Associate'
  }, {
    id: 13,
    name: 'Honorary'
  }]
}, {
  id: 2,
  name: 'Patronage',
  levels: [{
    id: 21,
    name: 'Patron'
  }, {
    id: 22,
    name: 'Benefactor'
  }]
}];

// Helper: tri-state for a country given allowedCountries/Regions/Groups sets.
const countryState = (country, sel) => {
  const allRegions = country.regions;
  const anySelected = sel.countries.has(country.name) || allRegions.some(r => sel.regions.has(r.name) || r.groups.some(g => sel.groups.has(g)));
  if (!anySelected) return 'none';
  const allSelected = sel.countries.has(country.name) && (allRegions.length === 0 || allRegions.every(r => sel.regions.has(r.name) && (r.groups.length === 0 || r.groups.every(g => sel.groups.has(g)))));
  return allSelected ? 'all' : 'partial';
};
const regionState = (region, sel) => {
  const any = sel.regions.has(region.name) || region.groups.some(g => sel.groups.has(g));
  if (!any) return 'none';
  const all = sel.regions.has(region.name) && (region.groups.length === 0 || region.groups.every(g => sel.groups.has(g)));
  return all ? 'all' : 'partial';
};
const tierCategoryState = (cat, sel) => {
  const any = cat.levels.some(l => sel.tierLevels.has(l.id));
  if (!any) return 'none';
  return cat.levels.every(l => sel.tierLevels.has(l.id)) ? 'all' : 'partial';
};
const cbClass = state => state === 'all' ? 'tree-cb tree-cb--checked' : state === 'partial' ? 'tree-cb tree-cb--partial' : 'tree-cb';
const TreeCheckbox = ({
  state,
  onClick,
  children
}) => /*#__PURE__*/React.createElement("div", {
  className: "tree-cb-row",
  onClick: e => {
    e.stopPropagation();
    onClick();
  }
}, /*#__PURE__*/React.createElement("span", {
  className: cbClass(state)
}), /*#__PURE__*/React.createElement("span", {
  className: "tree-cb-label"
}, children));
const Chevron = ({
  open,
  hidden
}) => /*#__PURE__*/React.createElement("span", {
  className: "audience-tree-chevron" + (open ? " audience-tree-chevron--open" : "") + (hidden ? " audience-tree-chevron--hidden" : "")
}, "\u203A");
const AudienceTree = ({
  value,
  onChange
}) => {
  // value = { countries: Set, regions: Set, groups: Set, tierLevels: Set, roles: [], positions: [] }
  const [expandedCountries, setExpandedCountries] = React.useState(new Set());
  const [expandedRegions, setExpandedRegions] = React.useState(new Set());
  const [expandedTierCats, setExpandedTierCats] = React.useState(new Set());
  const toggleSet = (set, key) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);else next.add(key);
    return next;
  };
  const update = patch => onChange({
    ...value,
    ...patch
  });
  const toggle = (collection, key) => update({
    [collection]: toggleSet(value[collection], key)
  });
  const handleCountryClick = country => {
    const select = countryState(country, value) !== 'all';
    const countries = new Set(value.countries);
    const regions = new Set(value.regions);
    const groups = new Set(value.groups);
    if (select) {
      countries.add(country.name);
      country.regions.forEach(r => {
        regions.add(r.name);
        r.groups.forEach(g => groups.add(g));
      });
    } else {
      countries.delete(country.name);
      country.regions.forEach(r => {
        regions.delete(r.name);
        r.groups.forEach(g => groups.delete(g));
      });
    }
    update({
      countries,
      regions,
      groups
    });
  };
  const handleRegionClick = region => {
    const select = regionState(region, value) !== 'all';
    const regions = new Set(value.regions);
    const groups = new Set(value.groups);
    if (select) {
      regions.add(region.name);
      region.groups.forEach(g => groups.add(g));
    } else {
      regions.delete(region.name);
      region.groups.forEach(g => groups.delete(g));
    }
    update({
      regions,
      groups
    });
  };
  const handleTierCatClick = cat => {
    const select = tierCategoryState(cat, value) !== 'all';
    const tierLevels = new Set(value.tierLevels);
    cat.levels.forEach(l => {
      if (select) tierLevels.add(l.id);else tierLevels.delete(l.id);
    });
    update({
      tierLevels
    });
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "audience-fields"
  }, /*#__PURE__*/React.createElement("div", {
    className: "audience-group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "audience-group-header"
  }, "Location"), /*#__PURE__*/React.createElement("div", {
    className: "audience-tree"
  }, COMMUNITY_HIERARCHY.map(country => {
    const cOpen = expandedCountries.has(country.name);
    const cState = countryState(country, value);
    return /*#__PURE__*/React.createElement("div", {
      key: country.name
    }, /*#__PURE__*/React.createElement("div", {
      className: "audience-tree-row" + (country.regions.length > 0 ? " audience-tree-row--clickable" : ""),
      onClick: () => country.regions.length > 0 && setExpandedCountries(toggleSet(expandedCountries, country.name))
    }, /*#__PURE__*/React.createElement(Chevron, {
      open: cOpen,
      hidden: country.regions.length === 0
    }), /*#__PURE__*/React.createElement(TreeCheckbox, {
      state: cState,
      onClick: () => handleCountryClick(country)
    }, country.name)), cOpen && /*#__PURE__*/React.createElement("div", {
      className: "audience-tree-children"
    }, country.regions.map(region => {
      const rOpen = expandedRegions.has(region.name);
      const rState = regionState(region, value);
      return /*#__PURE__*/React.createElement("div", {
        key: region.name
      }, /*#__PURE__*/React.createElement("div", {
        className: "audience-tree-row" + (region.groups.length > 0 ? " audience-tree-row--clickable" : ""),
        onClick: () => region.groups.length > 0 && setExpandedRegions(toggleSet(expandedRegions, region.name))
      }, /*#__PURE__*/React.createElement(Chevron, {
        open: rOpen,
        hidden: region.groups.length === 0
      }), /*#__PURE__*/React.createElement(TreeCheckbox, {
        state: rState,
        onClick: () => handleRegionClick(region)
      }, region.name)), rOpen && /*#__PURE__*/React.createElement("div", {
        className: "audience-tree-children"
      }, region.groups.map(g => /*#__PURE__*/React.createElement("div", {
        key: g,
        className: "audience-tree-row"
      }, /*#__PURE__*/React.createElement(Chevron, {
        hidden: true
      }), /*#__PURE__*/React.createElement(TreeCheckbox, {
        state: value.groups.has(g) ? 'all' : 'none',
        onClick: () => toggle('groups', g)
      }, g)))));
    })));
  }))), /*#__PURE__*/React.createElement("div", {
    className: "audience-group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "audience-group-header"
  }, "Membership Tiers"), /*#__PURE__*/React.createElement("div", {
    className: "audience-tree"
  }, TIER_CATEGORIES.map(cat => {
    const open = expandedTierCats.has(cat.id);
    const state = tierCategoryState(cat, value);
    return /*#__PURE__*/React.createElement("div", {
      key: cat.id
    }, /*#__PURE__*/React.createElement("div", {
      className: "audience-tree-row" + (cat.levels.length > 0 ? " audience-tree-row--clickable" : ""),
      onClick: () => cat.levels.length > 0 && setExpandedTierCats(toggleSet(expandedTierCats, cat.id))
    }, /*#__PURE__*/React.createElement(Chevron, {
      open: open,
      hidden: cat.levels.length === 0
    }), /*#__PURE__*/React.createElement(TreeCheckbox, {
      state: state,
      onClick: () => handleTierCatClick(cat)
    }, cat.name)), open && /*#__PURE__*/React.createElement("div", {
      className: "audience-tree-children"
    }, cat.levels.map(l => /*#__PURE__*/React.createElement("div", {
      key: l.id,
      className: "audience-tree-row"
    }, /*#__PURE__*/React.createElement(Chevron, {
      hidden: true
    }), /*#__PURE__*/React.createElement(TreeCheckbox, {
      state: value.tierLevels.has(l.id) ? 'all' : 'none',
      onClick: () => {
        const tierLevels = new Set(value.tierLevels);
        if (tierLevels.has(l.id)) tierLevels.delete(l.id);else tierLevels.add(l.id);
        update({
          tierLevels
        });
      }
    }, l.name)))));
  }))), /*#__PURE__*/React.createElement("div", {
    className: "audience-group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "audience-group-header"
  }, "Roles"), /*#__PURE__*/React.createElement("p", {
    className: "audience-group-help"
  }, "Type a role and press Enter."), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 0.85rem 0.85rem'
    }
  }, /*#__PURE__*/React.createElement(TagInput, {
    values: value.roles,
    onChange: roles => update({
      roles
    }),
    placeholder: "e.g. Admin, EventOrganiser\u2026"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "audience-group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "audience-group-header"
  }, "Positions"), /*#__PURE__*/React.createElement("p", {
    className: "audience-group-help"
  }, "Character positions. Type and press Enter."), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 0.85rem 0.85rem'
    }
  }, /*#__PURE__*/React.createElement(TagInput, {
    values: value.positions,
    onChange: positions => update({
      positions
    }),
    placeholder: "e.g. Captain, Medic\u2026"
  }))));
};

// Empty value
AudienceTree.empty = () => ({
  countries: new Set(),
  regions: new Set(),
  groups: new Set(),
  tierLevels: new Set(),
  roles: [],
  positions: []
});

// Summary string for badges/tooltips
AudienceTree.summary = value => {
  const parts = [];
  if (value.countries.size > 0) parts.push(value.countries.size + ' countries');
  if (value.regions.size > 0) parts.push(value.regions.size + ' regions');
  if (value.groups.size > 0) parts.push(value.groups.size + ' groups');
  if (value.tierLevels.size > 0) parts.push(value.tierLevels.size + ' tiers');
  if (value.roles.length > 0) parts.push(value.roles.length + ' roles');
  if (value.positions.length > 0) parts.push(value.positions.length + ' positions');
  return parts.join(' · ') || 'unrestricted';
};
window.AudienceTree = AudienceTree;
window.COMMUNITY_HIERARCHY = COMMUNITY_HIERARCHY;
window.TIER_CATEGORIES = TIER_CATEGORIES;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/AudienceTree.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/BrandSwitcher.jsx
try { (() => {
// Brand switcher — floating bottom-right control that flips :root[data-brand].
// Loads the brand catalogue from brand-profiles/manifest.json.
const LS_BRAND_KEY = 'nexus-ui-kit-brand-v1';
const BrandSwitcher = () => {
  const [brands, setBrands] = React.useState([]);
  const [active, setActive] = React.useState(() => {
    try {
      return localStorage.getItem(LS_BRAND_KEY) || 'nexus-default-dark';
    } catch {
      return 'nexus-default-dark';
    }
  });
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => {
    fetch(window.__resources && window.__resources.brandManifest || '../../brand-profiles/manifest.json').then(r => r.json()).then(setBrands).catch(() => setBrands([]));
  }, []);
  React.useEffect(() => {
    document.documentElement.dataset.brand = active;
    try {
      localStorage.setItem(LS_BRAND_KEY, active);
    } catch {}
  }, [active]);
  if (!open) {
    return /*#__PURE__*/React.createElement("button", {
      className: "brand-switcher brand-switcher--collapsed",
      onClick: () => setOpen(true),
      title: "Open brand switcher"
    }, /*#__PURE__*/React.createElement("div", {
      className: "brand-switcher__heading"
    }, /*#__PURE__*/React.createElement("span", {
      className: "brand-switcher__title"
    }, "Brand"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
        color: 'var(--accent)'
      }
    }, brands.find(b => b.id === active)?.communityName || active)));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "brand-switcher"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand-switcher__heading"
  }, /*#__PURE__*/React.createElement("span", {
    className: "brand-switcher__title"
  }, "Brand profile \xB7 ", brands.length), /*#__PURE__*/React.createElement("button", {
    className: "brand-switcher__toggle",
    onClick: () => setOpen(false),
    title: "Collapse"
  }, "\u2013")), /*#__PURE__*/React.createElement("div", {
    className: "brand-switcher__list"
  }, brands.map(b => /*#__PURE__*/React.createElement("button", {
    key: b.id,
    className: "brand-switcher__item" + (b.id === active ? " active" : ""),
    onClick: () => setActive(b.id),
    title: b.mood
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand-switcher__swatch"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: b.page
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: b.card
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: b.accent
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: b.text
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand-switcher__name"
  }, b.name), /*#__PURE__*/React.createElement("div", {
    className: "brand-switcher__sub"
  }, b.scheme, b.suggested ? ' · suggested' : ''))))));
};
window.BrandSwitcher = BrandSwitcher;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/BrandSwitcher.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Characters.jsx
try { (() => {
// Characters — roster grid.
const CHARACTERS_DATA = [{
  name: 'Aiden Vale',
  title: 'Captain of the Watch · House Vale',
  xp: 4820,
  faction: 'Vale',
  monogram: 'A'
}, {
  name: 'Lyra Quill',
  title: 'Chronicler · Aerin Citadel',
  xp: 3110,
  faction: 'Aerin',
  monogram: 'L'
}, {
  name: 'Bren Tor',
  title: 'Pathfinder · The Long Hall',
  xp: 2640,
  faction: 'Frostmarch',
  monogram: 'B'
}, {
  name: 'Sera Mae',
  title: 'Healer · House Mae',
  xp: 1980,
  faction: 'Mae',
  monogram: 'S'
}, {
  name: 'Iorek Vahn',
  title: 'Field Marshal · Northern Reaches',
  xp: 5410,
  faction: 'North',
  monogram: 'I'
}, {
  name: 'Mira Quen',
  title: 'Quartermaster · Tournament Council',
  xp: 1240,
  faction: 'Council',
  monogram: 'M'
}];
const Characters = ({
  onOpenModal
}) => {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "My Characters"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-gold-outline",
    onClick: () => onOpenModal({
      kind: 'char-new'
    })
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 14
  }), " New Character"))), /*#__PURE__*/React.createElement("div", {
    className: "char-grid"
  }, CHARACTERS_DATA.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.name,
    className: "char-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "char-portrait"
  }, /*#__PURE__*/React.createElement("div", {
    className: "char-portrait__monogram"
  }, c.monogram)), /*#__PURE__*/React.createElement("div", {
    className: "char-body"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "char-name"
  }, c.name), /*#__PURE__*/React.createElement("p", {
    className: "char-title-line"
  }, c.title), /*#__PURE__*/React.createElement("div", {
    className: "char-stats"
  }, /*#__PURE__*/React.createElement("span", null, "XP ", /*#__PURE__*/React.createElement("strong", null, c.xp.toLocaleString())), /*#__PURE__*/React.createElement("span", null, "Faction ", /*#__PURE__*/React.createElement("strong", null, c.faction))))))));
};
window.Characters = Characters;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Characters.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Events.jsx
try { (() => {
// Events — list of upcoming events with date squares, banners, location.
const EVENTS_DATA = [{
  id: 1,
  day: 18,
  month: 'NOV',
  name: 'Winter Convocation',
  location: 'Aerin Citadel, Vale Province',
  time: '18:00 – 23:00',
  attendees: 84,
  going: true,
  banner: 1
}, {
  id: 2,
  day: 2,
  month: 'DEC',
  name: 'Chronicler\'s Roundtable',
  location: 'The Long Hall',
  time: '14:00 – 16:00',
  attendees: 22,
  going: false,
  banner: 2
}, {
  id: 3,
  day: 14,
  month: 'DEC',
  name: 'Solstice Hunt',
  location: 'Northern Reaches',
  time: 'Dawn – Dusk',
  attendees: 56,
  going: true,
  banner: 3
}, {
  id: 4,
  day: 21,
  month: 'DEC',
  name: 'Yearend Council',
  location: 'Council Chambers (Members Only)',
  time: '19:00 – 21:00',
  attendees: 18,
  going: false,
  banner: 1
}, {
  id: 5,
  day: 5,
  month: 'JAN',
  name: 'New Year Tourney',
  location: 'Tournament Grounds',
  time: '10:00 – 18:00',
  attendees: 0,
  going: false,
  banner: 2
}];
const Events = ({
  onOpenModal
}) => {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Events"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-gold-outline",
    onClick: () => onOpenModal({
      kind: 'event-new'
    })
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 14
  }), " New Event"))), /*#__PURE__*/React.createElement("div", null, EVENTS_DATA.map(e => /*#__PURE__*/React.createElement("div", {
    className: "event-card",
    key: e.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "event-banner event-banner--photo-" + e.banner
  }), /*#__PURE__*/React.createElement("div", {
    className: "event-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "event-date-square"
  }, /*#__PURE__*/React.createElement("div", {
    className: "day"
  }, e.day), /*#__PURE__*/React.createElement("div", {
    className: "month"
  }, e.month)), /*#__PURE__*/React.createElement("div", {
    className: "event-info"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "event-name"
  }, e.name), /*#__PURE__*/React.createElement("div", {
    className: "event-location"
  }, /*#__PURE__*/React.createElement(IconMapPin, {
    size: 12,
    style: {
      verticalAlign: 'middle',
      marginRight: 4,
      opacity: 0.7
    }
  }), e.location), /*#__PURE__*/React.createElement("div", {
    className: "event-meta"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(IconClock, {
    size: 12,
    style: {
      verticalAlign: 'middle',
      marginRight: 4,
      opacity: 0.7
    }
  }), e.time), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(IconUsers, {
    size: 12,
    style: {
      verticalAlign: 'middle',
      marginRight: 4,
      opacity: 0.7
    }
  }), e.attendees, " going"))), /*#__PURE__*/React.createElement("div", {
    className: "event-badges"
  }, e.going && /*#__PURE__*/React.createElement("div", {
    className: "event-going-badge"
  }, "Going")))))));
};
window.Events = Events;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Events.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Forum.jsx
try { (() => {
// Forum — category list with a rich "New category" modal that includes
// the audience-restriction tree (Country/Region/Group + Tiers + Roles + Positions).
const FORUM_DEFAULT = [{
  id: 1,
  name: 'Lore & Setting',
  desc: 'The myths, histories, and chronicles that shape the world.',
  threads: 142,
  posts: 3801,
  restricted: null
}, {
  id: 2,
  name: 'Events',
  desc: 'Planning, recaps, and discussion for upcoming convocations.',
  threads: 56,
  posts: 920,
  restricted: null
}, {
  id: 3,
  name: 'Strategy & Tactics',
  desc: 'Build discussion, party composition, encounter prep.',
  threads: 88,
  posts: 2104,
  restricted: null
}, {
  id: 4,
  name: 'Council Chambers',
  desc: 'Discussion restricted to event organisers and council members.',
  threads: 12,
  posts: 134,
  restricted: {
    countries: new Set(),
    regions: new Set(['Vale']),
    groups: new Set(['Council']),
    tierLevels: new Set([11]),
    roles: ['Admin', 'EventOrganiser'],
    positions: ['Captain']
  }
}, {
  id: 5,
  name: 'Off-Topic',
  desc: 'Anything else that belongs in the guild hall.',
  threads: 211,
  posts: 5602,
  restricted: null
}];
const Forum = () => {
  const [cats, setCats] = React.useState(FORUM_DEFAULT);
  const [editing, setEditing] = React.useState(null); // { id?, name, desc, restricted }

  const openCreate = () => setEditing({
    id: null,
    name: '',
    desc: '',
    restricted: null
  });
  const openEdit = cat => setEditing({
    id: cat.id,
    name: cat.name,
    desc: cat.desc,
    restricted: cat.restricted ? {
      ...cat.restricted,
      // re-hydrate Sets (in case they were serialised somewhere)
      countries: new Set(cat.restricted.countries),
      regions: new Set(cat.restricted.regions),
      groups: new Set(cat.restricted.groups),
      tierLevels: new Set(cat.restricted.tierLevels)
    } : null
  });
  const save = data => {
    if (data.id) {
      setCats(prev => prev.map(c => c.id === data.id ? {
        ...c,
        ...data
      } : c));
    } else {
      setCats(prev => [...prev, {
        id: Date.now(),
        threads: 0,
        posts: 0,
        ...data
      }]);
    }
    setEditing(null);
  };
  const remove = id => setCats(prev => prev.filter(c => c.id !== id));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Forum"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: openCreate
  }, "New Category"))), /*#__PURE__*/React.createElement("div", null, cats.map(cat => /*#__PURE__*/React.createElement("div", {
    className: "card forum-cat",
    key: cat.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-body"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("h3", {
    className: "card-title",
    style: {
      marginBottom: '0.35rem'
    }
  }, cat.name), /*#__PURE__*/React.createElement("p", {
    className: "card-text",
    style: {
      marginBottom: '0.5rem'
    }
  }, cat.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '1rem',
      alignItems: 'center',
      fontSize: '0.85rem',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, cat.threads, " threads"), /*#__PURE__*/React.createElement("span", null, cat.posts.toLocaleString(), " posts"), cat.restricted && /*#__PURE__*/React.createElement("span", {
    className: "restricted-pill",
    title: AudienceTree.summary(cat.restricted)
  }, /*#__PURE__*/React.createElement(IconKey, {
    size: 11
  }), " Restricted \xB7 ", AudienceTree.summary(cat.restricted)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '0.5rem',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-outline-secondary btn-sm",
    onClick: () => openEdit(cat)
  }, "Edit"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-danger btn-sm",
    onClick: () => remove(cat.id)
  }, "Delete")))))), editing && /*#__PURE__*/React.createElement(CategoryModal, {
    initial: editing,
    onClose: () => setEditing(null),
    onSave: save
  }));
};
const CategoryModal = ({
  initial,
  onClose,
  onSave
}) => {
  const [name, setName] = React.useState(initial.name || '');
  const [desc, setDesc] = React.useState(initial.desc || '');
  const [restrict, setRestrict] = React.useState(!!initial.restricted);
  const [audience, setAudience] = React.useState(initial.restricted || AudienceTree.empty());
  const submit = () => {
    onSave({
      id: initial.id,
      name: name || 'Untitled',
      desc,
      restricted: restrict ? audience : null
    });
  };
  return /*#__PURE__*/React.createElement(Modal, {
    open: true,
    onClose: onClose,
    title: initial.id ? 'Edit Category' : 'New Category',
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      onClick: onClose
    }, "Cancel"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: submit
    }, "Save"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Category name",
    value: name,
    onChange: e => setName(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Description"), /*#__PURE__*/React.createElement("textarea", {
    className: "form-control",
    rows: 3,
    value: desc,
    onChange: e => setDesc(e.target.value)
  })), /*#__PURE__*/React.createElement("label", {
    className: "audience-toggle"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: restrict,
    onChange: e => setRestrict(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", null, "Restrict access to specific audience")), restrict && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '0.5rem'
    }
  }, /*#__PURE__*/React.createElement(AudienceTree, {
    value: audience,
    onChange: setAudience
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '0.75rem',
      padding: '0.6rem 0.85rem',
      background: 'var(--container-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      fontSize: '0.82rem',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-body)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--accent)',
      fontFamily: 'var(--font-ui)',
      fontSize: '0.7rem',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      display: 'block',
      marginBottom: 4
    }
  }, "Will be visible to"), AudienceTree.summary(audience))));
};
window.Forum = Forum;
window.FORUM_DEFAULT = FORUM_DEFAULT;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Forum.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Home.jsx
try { (() => {
// Home — hero with hex emblem + announcement banner + feature-card grid.
const Home = ({
  onNavigate,
  brand = "Nexus",
  tagline = "The world awaits. Join the adventure."
}) => {
  const [annDismissed, setAnnDismissed] = React.useState(false);
  const features = [{
    id: 'forum',
    icon: IconForum,
    title: 'Forum',
    desc: 'Engage with the community. Discuss lore, strategy, and the latest events across all realms.'
  }, {
    id: 'wiki',
    icon: IconBookOpen,
    title: 'Wiki',
    desc: 'Discover the chronicles of the community. Lore, guides, and history — written by the community.'
  }, {
    id: 'events',
    icon: IconCalendar,
    title: 'Events',
    desc: 'Join community gatherings, raids, and tournaments. Mark yourself as going and track upcoming activities.'
  }, {
    id: 'documents',
    icon: IconFile,
    title: 'Documents',
    desc: 'Access rulebooks, guides, and shared files.'
  }, {
    id: 'characters',
    icon: IconShield,
    title: 'Characters',
    desc: 'Create and manage your in-world identities. Track your roster and progression.'
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, !annDismissed && /*#__PURE__*/React.createElement("div", {
    className: "ann-banner",
    onClick: () => onNavigate('announcements')
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
      flex: 1,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ann-banner__label"
  }, "Announcement"), /*#__PURE__*/React.createElement("span", {
    className: "ann-banner__title"
  }, "Winter Convocation \u2014 registration closes Friday"), /*#__PURE__*/React.createElement("span", {
    className: "ann-banner__date"
  }, "Nov 18")), /*#__PURE__*/React.createElement("button", {
    className: "ann-banner__close",
    onClick: e => {
      e.stopPropagation();
      setAnnDismissed(true);
    }
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "home-hero"
  }, /*#__PURE__*/React.createElement("img", {
    src: window.__resources && window.__resources.emblem || "../../assets/nexus-emblem.svg",
    alt: "",
    className: "home-hero__emblem"
  }), /*#__PURE__*/React.createElement("h1", {
    className: "home-hero__title"
  }, /*#__PURE__*/React.createElement("span", {
    className: "first"
  }, brand[0]), brand.slice(1)), /*#__PURE__*/React.createElement("p", {
    className: "home-hero__sub"
  }, tagline), /*#__PURE__*/React.createElement("div", {
    className: "home-hero__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    onClick: () => onNavigate('my-events')
  }, "My Events"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    onClick: () => onNavigate('announcements')
  }, "Announcements"))), /*#__PURE__*/React.createElement("div", {
    className: "home-grid"
  }, features.map(f => /*#__PURE__*/React.createElement("a", {
    key: f.id,
    className: "feature-card",
    href: "#",
    onClick: e => {
      e.preventDefault();
      onNavigate(f.id);
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "feature-card__icon"
  }, /*#__PURE__*/React.createElement(f.icon, {
    size: 40,
    sw: 1.5
  })), /*#__PURE__*/React.createElement("h3", null, f.title), /*#__PURE__*/React.createElement("p", null, f.desc)))));
};
window.Home = Home;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Home.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Login.jsx
try { (() => {
// Login screen — full-bleed dark-with-radial-glow + login card.
const Login = ({
  onSignIn,
  brand = "Nexus",
  tagline = "Enter your credentials to continue"
}) => {
  const [email, setEmail] = React.useState("aiden@vale.com");
  const [password, setPassword] = React.useState("hunter2");
  const [loading, setLoading] = React.useState(false);
  const submit = e => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSignIn();
    }, 700);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "login-container"
  }, /*#__PURE__*/React.createElement("div", {
    className: "login-card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "login-brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "first"
  }, brand[0]), brand.slice(1)), /*#__PURE__*/React.createElement("p", {
    className: "login-subtitle"
  }, tagline)), /*#__PURE__*/React.createElement("form", {
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1.5rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Email Address"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "you@example.com"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1.5rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Password"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "password",
    value: password,
    onChange: e => setPassword(e.target.value),
    placeholder: "Enter your password"
  })), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn btn-primary btn-lg",
    style: {
      width: '100%',
      marginBottom: '0.75rem'
    },
    disabled: loading
  }, loading ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "loading-orb",
    style: {
      width: 14,
      height: 14,
      borderWidth: 1.5,
      marginRight: 8
    }
  }), "Signing in...") : 'Sign In')), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      color: 'var(--text-muted)',
      fontSize: '0.9rem',
      margin: '0.5rem 0 0'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault()
  }, "New to ", brand, "? Create an account")), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      color: 'var(--text-muted)',
      fontSize: '0.85rem',
      margin: '1.5rem 0 1rem'
    }
  }, "\u2014 or \u2014"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-outline-secondary",
    style: {
      width: '100%',
      textTransform: 'none',
      letterSpacing: 0,
      fontWeight: 500,
      fontSize: '0.9rem',
      gap: '0.6rem'
    },
    onClick: onSignIn,
    type: "button"
  }, /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 48 48",
    width: "18",
    height: "18"
  }, /*#__PURE__*/React.createElement("path", {
    fill: "#EA4335",
    d: "M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.8 2.4 30.3 0 24 0 14.7 0 6.7 5.4 2.8 13.3l7.8 6C12.5 13 17.8 9.5 24 9.5z"
  }), /*#__PURE__*/React.createElement("path", {
    fill: "#4285F4",
    d: "M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.6 37.3 46.5 31.4 46.5 24.5z"
  }), /*#__PURE__*/React.createElement("path", {
    fill: "#FBBC05",
    d: "M10.6 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.5 10.8l8.1-6.1z"
  }), /*#__PURE__*/React.createElement("path", {
    fill: "#34A853",
    d: "M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.2-8.4 2.2-6.2 0-11.5-4.2-13.4-9.9l-8.1 6.1C6.7 42.6 14.7 48 24 48z"
  })), "Continue with Google")));
};
window.Login = Login;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Login.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Modal.jsx
try { (() => {
// Modal — shared across screens.
const Modal = ({
  open,
  title,
  onClose,
  children,
  footer
}) => {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 1050,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(4,6,10,0.85)',
      backdropFilter: 'blur(4px)',
      padding: '1rem'
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal-content",
    style: {
      width: '100%',
      maxWidth: 520
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal-header"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "modal-title"
  }, title), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      background: 'none',
      border: 'none',
      color: 'var(--text-muted)',
      fontSize: '1.4rem',
      cursor: 'pointer',
      lineHeight: 1,
      padding: 0
    }
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "modal-body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "modal-footer"
  }, footer)));
};

// Forum / Event / Wiki / Character new-item modal body
const ModalForms = {
  'forum-new': ({
    state,
    set
  }) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Category name",
    value: state.name || '',
    onChange: e => set({
      ...state,
      name: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Description"), /*#__PURE__*/React.createElement("textarea", {
    className: "form-control",
    rows: 3,
    value: state.desc || '',
    onChange: e => set({
      ...state,
      desc: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "form-check"
  }, /*#__PURE__*/React.createElement("input", {
    className: "form-check-input",
    type: "checkbox",
    id: "restrict",
    checked: !!state.restricted,
    onChange: e => set({
      ...state,
      restricted: e.target.checked
    })
  }), /*#__PURE__*/React.createElement("label", {
    className: "form-check-label",
    htmlFor: "restrict"
  }, "Restrict access to specific audience"))),
  'event-new': ({
    state,
    set
  }) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Event name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Winter Convocation",
    value: state.name || '',
    onChange: e => set({
      ...state,
      name: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '1rem',
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Date"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "date"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Time"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "time",
    defaultValue: "18:00"
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Location"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Aerin Citadel, Vale Province"
  }))),
  'wiki-new': ({
    state,
    set
  }) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Page title"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "The Founding of Aerin",
    value: state.title || '',
    onChange: e => set({
      ...state,
      title: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Category"), /*#__PURE__*/React.createElement("select", {
    className: "form-control"
  }, /*#__PURE__*/React.createElement("option", null, "Lore"), /*#__PURE__*/React.createElement("option", null, "Geography"), /*#__PURE__*/React.createElement("option", null, "Factions"), /*#__PURE__*/React.createElement("option", null, "Bestiary"), /*#__PURE__*/React.createElement("option", null, "Rules"), /*#__PURE__*/React.createElement("option", null, "How-To")))),
  'char-new': ({
    state,
    set
  }) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Character name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Aiden Vale",
    value: state.name || '',
    onChange: e => set({
      ...state,
      name: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Title / position"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Captain of the Watch"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Faction"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "House Vale"
  }))),
  'user-new': ({
    state,
    set
  }) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '1rem',
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "First name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Rosa"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Last name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Fell"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "email",
    placeholder: "rosa.fell@example.com"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Role"), /*#__PURE__*/React.createElement("select", {
    className: "form-control"
  }, /*#__PURE__*/React.createElement("option", null, "User"), /*#__PURE__*/React.createElement("option", null, "Event Organiser"), /*#__PURE__*/React.createElement("option", null, "Analyst"), /*#__PURE__*/React.createElement("option", null, "Admin")))),
  'brand-new': ({
    state,
    set
  }) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Profile name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "e.g. Spring Festival"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Community name"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Used in the nav, page titles, and hero"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '1rem'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Tagline"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    placeholder: "Short community motto"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '1rem'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Background"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "color",
    defaultValue: "#07090f",
    style: {
      padding: 4,
      height: 38
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Accent"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "color",
    defaultValue: "#c9a84c",
    style: {
      padding: 4,
      height: 38
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, "Text"), /*#__PURE__*/React.createElement("input", {
    className: "form-control",
    type: "color",
    defaultValue: "#d8cdb8",
    style: {
      padding: 4,
      height: 38
    }
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-dim)',
      fontSize: '0.8rem',
      margin: '0.75rem 0 0'
    }
  }, "The full editor in production has 20+ colour fields, font pickers, and a terminology dictionary."))
};
const MODAL_TITLES = {
  'forum-new': 'New Category',
  'event-new': 'New Event',
  'wiki-new': 'New Page',
  'char-new': 'New Character',
  'user-new': 'Create User',
  'brand-new': 'New Brand Profile'
};
window.Modal = Modal;
window.ModalForms = ModalForms;
window.MODAL_TITLES = MODAL_TITLES;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Modal.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Placeholder.jsx
try { (() => {
// Placeholder screen — for routes we haven't fully built out.
const Placeholder = ({
  title,
  message,
  icon: Icon
}) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
  className: "kit-page-header"
}, /*#__PURE__*/React.createElement("h1", null, title)), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem',
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    textAlign: 'center'
  }
}, Icon && /*#__PURE__*/React.createElement("div", {
  style: {
    color: 'var(--text-muted)',
    opacity: 0.5,
    marginBottom: '1.5rem'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  size: 56,
  sw: 1.2
})), /*#__PURE__*/React.createElement("h3", {
  style: {
    color: 'var(--text-bright)',
    marginBottom: '0.75rem'
  }
}, title), /*#__PURE__*/React.createElement("p", {
  style: {
    color: 'var(--text-muted)',
    maxWidth: 420,
    margin: 0,
    lineHeight: 1.6
  }
}, message)));
window.Placeholder = Placeholder;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Placeholder.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Sidebar.jsx
try { (() => {
// Sidebar — mirrors NavMenu.razor with section accordions + active state.
const Sidebar = ({
  active,
  onNavigate,
  onSignOut,
  brand = "Nexus"
}) => {
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const toggle = key => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);else next.add(key);
      return next;
    });
  };
  const isOpen = key => !collapsed.has(key);
  const Item = ({
    id,
    label,
    icon: Icon,
    indent = true
  }) => /*#__PURE__*/React.createElement("div", {
    className: "sidebar__item" + (indent ? "" : " sidebar__item--top")
  }, /*#__PURE__*/React.createElement("a", {
    className: "nav-link" + (active === id ? " active" : ""),
    onClick: e => {
      e.preventDefault();
      onNavigate(id);
    },
    href: "#"
  }, /*#__PURE__*/React.createElement(Icon, {
    size: 15
  }), /*#__PURE__*/React.createElement("span", null, label)));
  const SectionHeader = ({
    id,
    label
  }) => /*#__PURE__*/React.createElement("button", {
    className: "sidebar__section",
    onClick: () => toggle(id),
    type: "button"
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement(IconChevron, {
    size: 10,
    className: "sidebar__chevron" + (!isOpen(id) ? " sidebar__chevron--collapsed" : "")
  }));
  const SectionItems = ({
    id,
    children
  }) => /*#__PURE__*/React.createElement("div", {
    className: "sidebar__section-items" + (!isOpen(id) ? " sidebar__section-items--hidden" : "")
  }, children);
  const renderBrand = () => {
    if (brand.length === 0) return brand;
    return /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
      className: "first"
    }, brand[0]), brand.slice(1));
  };
  return /*#__PURE__*/React.createElement("aside", {
    className: "sidebar"
  }, /*#__PURE__*/React.createElement("a", {
    className: "sidebar__brand",
    href: "#",
    onClick: e => {
      e.preventDefault();
      onNavigate('home');
    }
  }, renderBrand()), /*#__PURE__*/React.createElement("div", {
    className: "sidebar__scroll"
  }, /*#__PURE__*/React.createElement(Item, {
    id: "home",
    label: "Home",
    icon: IconHome,
    indent: false
  }), /*#__PURE__*/React.createElement(SectionHeader, {
    id: "characters",
    label: "Characters"
  }), /*#__PURE__*/React.createElement(SectionItems, {
    id: "characters"
  }, /*#__PURE__*/React.createElement(Item, {
    id: "characters",
    label: "My Characters",
    icon: IconShield
  })), /*#__PURE__*/React.createElement(SectionHeader, {
    id: "events",
    label: "Events"
  }), /*#__PURE__*/React.createElement(SectionItems, {
    id: "events"
  }, /*#__PURE__*/React.createElement(Item, {
    id: "events",
    label: "Events",
    icon: IconCalendar
  }), /*#__PURE__*/React.createElement(Item, {
    id: "my-events",
    label: "My Events",
    icon: IconCalendarCheck
  }), /*#__PURE__*/React.createElement(Item, {
    id: "calendar",
    label: "Event Calendar",
    icon: IconCalendarDays
  })), /*#__PURE__*/React.createElement(SectionHeader, {
    id: "community",
    label: "Community"
  }), /*#__PURE__*/React.createElement(SectionItems, {
    id: "community"
  }, /*#__PURE__*/React.createElement(Item, {
    id: "announcements",
    label: "Announcements",
    icon: IconSend
  }), /*#__PURE__*/React.createElement(Item, {
    id: "documents",
    label: "Documents",
    icon: IconFile
  }), /*#__PURE__*/React.createElement(Item, {
    id: "forum",
    label: "Forum",
    icon: IconForum
  }), /*#__PURE__*/React.createElement(Item, {
    id: "wiki",
    label: "Wiki",
    icon: IconBook
  })), /*#__PURE__*/React.createElement(SectionHeader, {
    id: "analytics",
    label: "Analytics"
  }), /*#__PURE__*/React.createElement(SectionItems, {
    id: "analytics"
  }, /*#__PURE__*/React.createElement(Item, {
    id: "analytics",
    label: "Action Log",
    icon: IconBarChart
  }), /*#__PURE__*/React.createElement(Item, {
    id: "analytics-charts",
    label: "Activity Charts",
    icon: IconActivity
  }), /*#__PURE__*/React.createElement(Item, {
    id: "analytics-attendances",
    label: "Event Attendances",
    icon: IconUsers
  })), /*#__PURE__*/React.createElement(SectionHeader, {
    id: "admin",
    label: "Administration"
  }), /*#__PURE__*/React.createElement(SectionItems, {
    id: "admin"
  }, /*#__PURE__*/React.createElement(Item, {
    id: "users",
    label: "Users",
    icon: IconUsers
  }), /*#__PURE__*/React.createElement(Item, {
    id: "roles",
    label: "Roles",
    icon: IconShield
  }), /*#__PURE__*/React.createElement(Item, {
    id: "permissions",
    label: "Permissions",
    icon: IconKey
  }), /*#__PURE__*/React.createElement(Item, {
    id: "settings",
    label: "Settings",
    icon: IconSettings
  }), /*#__PURE__*/React.createElement(Item, {
    id: "brand",
    label: "Brand Profiles",
    icon: IconBookOpen
  })), /*#__PURE__*/React.createElement(SectionHeader, {
    id: "account",
    label: "Account"
  }), /*#__PURE__*/React.createElement(SectionItems, {
    id: "account"
  }, /*#__PURE__*/React.createElement(Item, {
    id: "profile",
    label: "Profile",
    icon: IconUser
  }), /*#__PURE__*/React.createElement("div", {
    className: "sidebar__item"
  }, /*#__PURE__*/React.createElement("a", {
    className: "nav-link",
    href: "#",
    onClick: e => {
      e.preventDefault();
      onSignOut();
    },
    style: {
      color: 'rgba(192,57,43,0.7)'
    }
  }, /*#__PURE__*/React.createElement(IconLogOut, {
    size: 15
  }), /*#__PURE__*/React.createElement("span", null, "Sign Out"))))));
};
window.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/TagInput.jsx
try { (() => {
// TagInput — small chip / tag entry used inside the AudienceTree (Roles, Positions, Tiers).
const TagInput = ({
  values,
  onChange,
  placeholder
}) => {
  const [draft, setDraft] = React.useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  const remove = v => onChange(values.filter(x => x !== v));
  const onKeyDown = e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      remove(values[values.length - 1]);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "tag-input"
  }, values.map(v => /*#__PURE__*/React.createElement("span", {
    key: v,
    className: "tag-input__tag"
  }, v, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "tag-input__remove",
    onClick: () => remove(v)
  }, "\xD7"))), /*#__PURE__*/React.createElement("input", {
    className: "tag-input__entry",
    value: draft,
    onChange: e => setDraft(e.target.value),
    onKeyDown: onKeyDown,
    onBlur: commit,
    placeholder: placeholder || ''
  }));
};
window.TagInput = TagInput;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/TagInput.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/Wiki.jsx
try { (() => {
// Wiki — sidebar of categories + list of pages.
const WIKI_CATS = ['All Pages', 'Lore', 'Geography', 'Factions', 'Bestiary', 'Rules', 'How-To'];
const WIKI_PAGES = [{
  title: 'The Founding of Aerin',
  excerpt: 'A summary of the four-realm accord and the events that led to the first convocation.',
  cat: 'Lore',
  editor: 'lyra.q',
  when: '3 days ago'
}, {
  title: 'The Northern Reaches',
  excerpt: 'Terrain, climate, and travel routes across the snowfields between Vale and the Frostmarch.',
  cat: 'Geography',
  editor: 'bren.t',
  when: '1 week ago'
}, {
  title: 'House Mae — Lineage',
  excerpt: 'Generational chart and notable members of House Mae since the founding.',
  cat: 'Factions',
  editor: 'sera.m',
  when: '2 weeks ago'
}, {
  title: 'Encounter Rules — v3',
  excerpt: 'Combat resolution, initiative order, and the revised wound table introduced last autumn.',
  cat: 'Rules',
  editor: 'aiden.v',
  when: '1 month ago'
}, {
  title: 'Crafting a Character',
  excerpt: 'Step-by-step walkthrough for new members preparing their first roster entry.',
  cat: 'How-To',
  editor: 'aiden.v',
  when: '2 months ago'
}];
const Wiki = ({
  onOpenModal
}) => {
  const [activeCat, setActiveCat] = React.useState('All Pages');
  const pages = activeCat === 'All Pages' ? WIKI_PAGES : WIKI_PAGES.filter(p => p.cat === activeCat);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header"
  }, /*#__PURE__*/React.createElement("h1", null, "Wiki"), /*#__PURE__*/React.createElement("div", {
    className: "kit-page-header__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    onClick: () => onOpenModal({
      kind: 'wiki-new'
    })
  }, "New Page"))), /*#__PURE__*/React.createElement("div", {
    className: "wiki-layout"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "wiki-cats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "label-ui",
    style: {
      marginBottom: '0.5rem',
      paddingLeft: '0.75rem'
    }
  }, "Categories"), WIKI_CATS.map(c => /*#__PURE__*/React.createElement("div", {
    key: c,
    className: "wiki-cat" + (c === activeCat ? " active" : ""),
    onClick: () => setActiveCat(c)
  }, c))), /*#__PURE__*/React.createElement("section", {
    className: "wiki-page-list"
  }, pages.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.title,
    className: "wiki-page-row"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "wiki-page-title"
  }, p.title), /*#__PURE__*/React.createElement("p", {
    className: "wiki-page-excerpt"
  }, p.excerpt), /*#__PURE__*/React.createElement("div", {
    className: "wiki-page-meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge bg-primary",
    style: {
      marginRight: 8
    }
  }, p.cat), "Last edited by ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "@", p.editor), " \xB7 ", p.when))), pages.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "alert alert-info"
  }, "No pages in this category yet."))));
};
window.Wiki = Wiki;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/Wiki.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/app.jsx
try { (() => {
// App — main shell. Persists login state + active page in localStorage so refresh keeps position.
const LS_KEY = 'nexus-ui-kit-state-v1';
const loadState = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
};
const App = () => {
  const initial = loadState();
  const [authed, setAuthed] = React.useState(!!initial.authed);
  const [page, setPage] = React.useState(initial.page || 'home');
  const [modal, setModal] = React.useState(null);
  const [modalState, setModalState] = React.useState({});
  React.useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      authed,
      page
    }));
  }, [authed, page]);
  const navigate = id => {
    setPage(id);
  };
  const openModal = cfg => {
    setModal(cfg);
    setModalState({});
  };
  const closeModal = () => {
    setModal(null);
    setModalState({});
  };
  const submitModal = () => {
    if (modal && modal.onSubmit) modal.onSubmit(modalState);
    closeModal();
  };
  if (!authed) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Login, {
      onSignIn: () => {
        setAuthed(true);
        setPage('home');
      },
      brand: "Nexus"
    }), /*#__PURE__*/React.createElement(BrandSwitcher, null));
  }
  let content = null;
  switch (page) {
    case 'home':
      content = /*#__PURE__*/React.createElement(Home, {
        onNavigate: navigate,
        brand: "Nexus"
      });
      break;
    case 'forum':
      content = /*#__PURE__*/React.createElement(Forum, {
        onOpenModal: openModal
      });
      break;
    case 'events':
      content = /*#__PURE__*/React.createElement(Events, {
        onOpenModal: openModal
      });
      break;
    case 'my-events':
      content = /*#__PURE__*/React.createElement(Events, {
        onOpenModal: openModal
      });
      break;
    case 'wiki':
      content = /*#__PURE__*/React.createElement(Wiki, {
        onOpenModal: openModal
      });
      break;
    case 'characters':
      content = /*#__PURE__*/React.createElement(Characters, {
        onOpenModal: openModal
      });
      break;
    case 'users':
      content = /*#__PURE__*/React.createElement(AdminUsers, {
        onOpenModal: openModal
      });
      break;
    case 'roles':
      content = /*#__PURE__*/React.createElement(AdminRoles, {
        onOpenModal: openModal
      });
      break;
    case 'brand':
      content = /*#__PURE__*/React.createElement(AdminBrandProfiles, {
        onOpenModal: openModal
      });
      break;
    case 'analytics':
      content = /*#__PURE__*/React.createElement(Analytics, {
        initialTab: "log"
      });
      break;
    case 'analytics-charts':
      content = /*#__PURE__*/React.createElement(Analytics, {
        initialTab: "charts"
      });
      break;
    case 'analytics-attendances':
      content = /*#__PURE__*/React.createElement(Analytics, {
        initialTab: "attendances"
      });
      break;
    case 'announcements':
      content = /*#__PURE__*/React.createElement(Placeholder, {
        title: "Announcements",
        message: "Site-wide news posts will appear here. Posts can be restricted to specific groups, regions, countries, or tiers.",
        icon: IconSend
      });
      break;
    case 'documents':
      content = /*#__PURE__*/React.createElement(Placeholder, {
        title: "Documents",
        message: "A file library for PDFs and DOCX uploads, with server-side conversion to HTML for in-app reading.",
        icon: IconFile
      });
      break;
    case 'calendar':
      content = /*#__PURE__*/React.createElement(Placeholder, {
        title: "Event Calendar",
        message: "A monthly grid view of all events. Filterable by country, region, and group.",
        icon: IconCalendarDays
      });
      break;
    case 'profile':
      content = /*#__PURE__*/React.createElement(Placeholder, {
        title: "Profile",
        message: "Account details, password change, and notification preferences.",
        icon: IconUser
      });
      break;
    case 'permissions':
      content = /*#__PURE__*/React.createElement(Placeholder, {
        title: "Permissions",
        message: "Per-permission audit and assignment view. Five built-in roles share 60+ named permissions.",
        icon: IconKey
      });
      break;
    case 'settings':
      content = /*#__PURE__*/React.createElement(Placeholder, {
        title: "Settings",
        message: "Platform-wide configuration: feature flags, community hierarchy, and tier definitions.",
        icon: IconSettings
      });
      break;
    default:
      content = /*#__PURE__*/React.createElement(Placeholder, {
        title: "Not found",
        message: "No page registered at route: " + page,
        icon: IconForum
      });
  }
  const ModalBody = modal && ModalForms[modal.kind];
  return /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: page,
    onNavigate: navigate,
    onSignOut: () => {
      setAuthed(false);
    },
    brand: "Nexus"
  }), /*#__PURE__*/React.createElement("main", {
    className: "kit-main"
  }, /*#__PURE__*/React.createElement("article", {
    className: "kit-content"
  }, content)), /*#__PURE__*/React.createElement(Modal, {
    open: !!modal,
    onClose: closeModal,
    title: modal ? MODAL_TITLES[modal.kind] : '',
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      onClick: closeModal
    }, "Cancel"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: submitModal
    }, "Save"))
  }, ModalBody && /*#__PURE__*/React.createElement(ModalBody, {
    state: modalState,
    set: setModalState
  })), /*#__PURE__*/React.createElement(BrandSwitcher, null));
};
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Inline-SVG icon set, matching the codebase's Feather-style stroke icons.
// Default 24x24, currentColor, stroke-width 2, round caps/joins.
const Svg = ({
  children,
  size = 18,
  sw = 2,
  ...rest
}) => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  width: size,
  height: size,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: sw,
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, rest), children);
const IconHome = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M10.707 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 19 11h-1v9a1 1 0 0 1-1 1h-4v-5H11v5H7a1 1 0 0 1-1-1v-9H5a1 1 0 0 1-.707-1.707l7-7z",
  fill: "currentColor",
  stroke: "none"
}));
const IconShield = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
}));
const IconCalendar = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "4",
  width: "18",
  height: "18",
  rx: "2"
}), /*#__PURE__*/React.createElement("line", {
  x1: "16",
  y1: "2",
  x2: "16",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "2",
  x2: "8",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "3",
  y1: "10",
  x2: "21",
  y2: "10"
}));
const IconCalendarCheck = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "4",
  width: "18",
  height: "18",
  rx: "2"
}), /*#__PURE__*/React.createElement("line", {
  x1: "16",
  y1: "2",
  x2: "16",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "2",
  x2: "8",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "3",
  y1: "10",
  x2: "21",
  y2: "10"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "9 16 11 18 15 14"
}));
const IconCalendarDays = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "4",
  width: "18",
  height: "18",
  rx: "2"
}), /*#__PURE__*/React.createElement("line", {
  x1: "16",
  y1: "2",
  x2: "16",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "2",
  x2: "8",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "3",
  y1: "10",
  x2: "21",
  y2: "10"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "14",
  x2: "16",
  y2: "14"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "18",
  x2: "13",
  y2: "18"
}));
const IconSend = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M22 2 11 13"
}), /*#__PURE__*/React.createElement("path", {
  d: "M22 2 15 22l-4-9-9-4 20-7z"
}));
const IconFile = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "14 2 14 8 20 8"
}), /*#__PURE__*/React.createElement("line", {
  x1: "16",
  y1: "13",
  x2: "8",
  y2: "13"
}), /*#__PURE__*/React.createElement("line", {
  x1: "16",
  y1: "17",
  x2: "8",
  y2: "17"
}));
const IconForum = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
}));
const IconBook = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
}));
const IconBookOpen = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
}));
const IconUsers = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "9",
  cy: "7",
  r: "4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M23 21v-2a4 4 0 0 0-3-3.87"
}), /*#__PURE__*/React.createElement("path", {
  d: "M16 3.13a4 4 0 0 1 0 7.75"
}));
const IconUser = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "7",
  r: "4"
}));
const IconUserPlus = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "8.5",
  cy: "7",
  r: "4"
}), /*#__PURE__*/React.createElement("line", {
  x1: "20",
  y1: "8",
  x2: "20",
  y2: "14"
}), /*#__PURE__*/React.createElement("line", {
  x1: "23",
  y1: "11",
  x2: "17",
  y2: "11"
}));
const IconLogIn = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "10 17 15 12 10 7"
}), /*#__PURE__*/React.createElement("line", {
  x1: "15",
  y1: "12",
  x2: "3",
  y2: "12"
}));
const IconLogOut = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "16 17 21 12 16 7"
}), /*#__PURE__*/React.createElement("line", {
  x1: "21",
  y1: "12",
  x2: "9",
  y2: "12"
}));
const IconBarChart = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("line", {
  x1: "18",
  y1: "20",
  x2: "18",
  y2: "10"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "20",
  x2: "12",
  y2: "4"
}), /*#__PURE__*/React.createElement("line", {
  x1: "6",
  y1: "20",
  x2: "6",
  y2: "14"
}));
const IconActivity = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("polyline", {
  points: "22 12 18 12 15 21 9 3 6 12 2 12"
}));
const IconChevron = p => /*#__PURE__*/React.createElement(Svg, _extends({}, p, {
  sw: 2.2
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 9l6 6 6-6"
}));
const IconChevronRight = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M9 18l6-6-6-6"
}));
const IconKey = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("circle", {
  cx: "8",
  cy: "15",
  r: "4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M10.85 12.15L19 4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M18 5l2 2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M15 8l2 2"
}));
const IconSettings = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "3"
}), /*#__PURE__*/React.createElement("path", {
  d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
}));
const IconClock = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "12 6 12 12 16 14"
}));
const IconMapPin = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("path", {
  d: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "10",
  r: "3"
}));
const IconPlus = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "5",
  x2: "12",
  y2: "19"
}), /*#__PURE__*/React.createElement("line", {
  x1: "5",
  y1: "12",
  x2: "19",
  y2: "12"
}));
const IconClose = p => /*#__PURE__*/React.createElement(Svg, p, /*#__PURE__*/React.createElement("line", {
  x1: "18",
  y1: "6",
  x2: "6",
  y2: "18"
}), /*#__PURE__*/React.createElement("line", {
  x1: "6",
  y1: "6",
  x2: "18",
  y2: "18"
}));
Object.assign(window, {
  Svg,
  IconHome,
  IconShield,
  IconCalendar,
  IconCalendarCheck,
  IconCalendarDays,
  IconSend,
  IconFile,
  IconForum,
  IconBook,
  IconBookOpen,
  IconUsers,
  IconUser,
  IconUserPlus,
  IconLogIn,
  IconLogOut,
  IconBarChart,
  IconActivity,
  IconChevron,
  IconChevronRight,
  IconKey,
  IconSettings,
  IconClock,
  IconMapPin,
  IconPlus,
  IconClose
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/icons.jsx", error: String((e && e.message) || e) }); }

})();
