import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { makeRider } from '@domain/entities/User';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { AddSavedPlace } from '../AddSavedPlace';
import { RemoveSavedPlace } from '../RemoveSavedPlace';
import { UpdateSavedPlace } from '../UpdateSavedPlace';

const FIXED_NOW = new Date('2026-04-27T00:00:00Z');

function makeEmail(value: string): Email {
  const r = Email.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function makeName(): PersonName {
  const r = PersonName.create({ first: 'Ada', last: 'Lovelace' });
  if (!r.ok) throw r.error;
  return r.value;
}

async function setupSignedIn() {
  const auth = new InMemoryAuthRepository();
  const users = new InMemoryUserRepository();
  auth.seedAccount({
    email: 'ada@yeapp.tech',
    password: 'hunter22',
  });
  await auth.signIn({
    email: makeEmail('ada@yeapp.tech'),
    password: 'hunter22',
  });
  const uid = (await auth.currentUserId())!;
  users.seed(
    makeRider({
      id: uid,
      email: makeEmail('ada@yeapp.tech'),
      name: makeName(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }),
  );
  return { auth, users, uid };
}

const validInput = {
  placeId: 'home',
  label: 'Home',
  addressLabel: '1 Main St',
  latitude: 37.4275,
  longitude: -122.1697,
};

describe('AddSavedPlace', () => {
  it('adds a saved place', async () => {
    const { auth, users, uid } = await setupSignedIn();
    const sut = new AddSavedPlace(auth, users);
    const r = await sut.execute(validInput);
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) {
      expect(after.value.savedPlaces).toHaveLength(1);
      expect(after.value.savedPlaces[0]?.label).toBe('Home');
    }
  });

  it('rejects malformed coordinates', async () => {
    const { auth, users } = await setupSignedIn();
    const sut = new AddSavedPlace(auth, users);
    const r = await sut.execute({ ...validInput, latitude: 91 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('coordinates_lat_out_of_range');
  });

  it('rejects empty label', async () => {
    const { auth, users } = await setupSignedIn();
    const sut = new AddSavedPlace(auth, users);
    const r = await sut.execute({ ...validInput, label: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects when place id already exists', async () => {
    const { auth, users } = await setupSignedIn();
    const sut = new AddSavedPlace(auth, users);
    await sut.execute(validInput);
    const r = await sut.execute(validInput);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('conflict');
      expect(r.error.code).toBe('saved_place_already_exists');
    }
  });

  it('returns AuthorizationError when not signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const users = new InMemoryUserRepository();
    const sut = new AddSavedPlace(auth, users);
    const r = await sut.execute(validInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('authorization');
  });
});

describe('UpdateSavedPlace', () => {
  it('renames an existing place', async () => {
    const { auth, users, uid } = await setupSignedIn();
    const add = new AddSavedPlace(auth, users);
    await add.execute(validInput);
    const sut = new UpdateSavedPlace(auth, users);

    const r = await sut.execute({ placeId: 'home', label: 'My Place' });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) {
      expect(after.value.savedPlaces[0]?.label).toBe('My Place');
      // address unchanged
      expect(after.value.savedPlaces[0]?.address.label).toBe('1 Main St');
    }
  });

  it('updates coordinates', async () => {
    const { auth, users, uid } = await setupSignedIn();
    const add = new AddSavedPlace(auth, users);
    await add.execute(validInput);
    const sut = new UpdateSavedPlace(auth, users);

    const r = await sut.execute({
      placeId: 'home',
      latitude: 40,
      longitude: -75,
    });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) {
      expect(after.value.savedPlaces[0]?.address.coordinates.latitude).toBe(40);
      expect(after.value.savedPlaces[0]?.address.coordinates.longitude).toBe(
        -75,
      );
      // label preserved
      expect(after.value.savedPlaces[0]?.label).toBe('Home');
    }
  });

  it('returns NotFoundError when the place does not exist', async () => {
    const { auth, users } = await setupSignedIn();
    const sut = new UpdateSavedPlace(auth, users);
    const r = await sut.execute({ placeId: 'nope', label: 'X' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('not_found');
      expect(r.error.code).toBe('saved_place_not_found');
    }
  });

  it('rejects malformed new coordinates', async () => {
    const { auth, users } = await setupSignedIn();
    const add = new AddSavedPlace(auth, users);
    await add.execute(validInput);
    const sut = new UpdateSavedPlace(auth, users);
    const r = await sut.execute({ placeId: 'home', latitude: 999 });
    expect(r.ok).toBe(false);
  });
});

describe('RemoveSavedPlace', () => {
  it('removes an existing place', async () => {
    const { auth, users, uid } = await setupSignedIn();
    const add = new AddSavedPlace(auth, users);
    await add.execute(validInput);
    const sut = new RemoveSavedPlace(auth, users);

    const r = await sut.execute({ placeId: 'home' });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.savedPlaces).toHaveLength(0);
  });

  it('returns NotFoundError for an unknown place', async () => {
    const { auth, users } = await setupSignedIn();
    const sut = new RemoveSavedPlace(auth, users);
    const r = await sut.execute({ placeId: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('rejects malformed placeId', async () => {
    const { auth, users } = await setupSignedIn();
    const sut = new RemoveSavedPlace(auth, users);
    const r = await sut.execute({ placeId: '' });
    expect(r.ok).toBe(false);
  });
});
